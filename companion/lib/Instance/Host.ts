import LogController, { Logger } from '../Log/Controller.js'
import { nanoid } from 'nanoid'
import path from 'path'
import { InstanceModuleWrapperDependencies, SocketEventsHandler } from './Wrapper.js'
import fs from 'fs-extra'
import ejson from 'ejson'
import { getNodeJsPath, getNodeJsPermissionArguments } from './NodePath.js'
import { RespawnMonitor } from '@companion-app/shared/Respawn.js'
import type { ConnectionConfig } from '@companion-app/shared/Model/Connections.js'
import { isModuleApiVersionCompatible } from '@companion-app/shared/ModuleApiVersionCheck.js'
import type { ModuleVersionInfo } from './Types.js'
import type { SomeEntityModel } from '@companion-app/shared/Model/EntityModel.js'
import { CompanionOptionValues } from '@companion-module/base'
import { Serializable } from 'child_process'
import { createRequire } from 'module'
import { assertNever } from '@companion-app/shared/Util.js'
import debounceFn from 'debounce-fn'

const require = createRequire(import.meta.url)

/**
 * A backoff sleep strategy
 * @returns ms to sleep
 */
function sleepStrategy(i: number): number {
	const low = 3
	const min = 1000
	const max = 60 * 1000
	if (i < low) {
		return min
	} else {
		return Math.min(Math.pow(2, i - low) * 1000, max)
	}
}

/**
 *
 */
export function ConnectionDebugLogRoom(id: string): `connection-debug:update:${string}` {
	return `connection-debug:update:${id}`
}

enum ModuleChildState {
	/** A state changed has been requested, but has not begun */
	INVALIDATED = 'invalidated',
	/** A state change is in progress */
	INPROGRESS = 'in_progress',
	/** A state change is in progress, and the config/info has changed so needs to be re-run */
	INPROGRESS_INVALIDATED = 'in_progress_invalidated',
	/** The state has settled */
	RUNNING = 'running',

	// QUEUED = 'queued',
	// STARTING = 'starting',
	// RUNNING = 'running',
	// STOPPING = 'stopping',
	// STOPPED = 'stopped',

	// STARTING_INVALIDATED = 'starting_invalidated',
	// STOPPING_INVALIDATED = 'stopping_invalidated',
	// QUEUED_RESTART = 'queued_restart',
}

interface ModuleChild {
	readonly creationId: string
	readonly connectionId: string
	logger: Logger
	restartCount: number
	state: ModuleChildState
	isReady: boolean
	monitor?: RespawnMonitor
	handler?: SocketEventsHandler
	authToken?: string
	delayStartUntil?: number
	// crashed?: NodeJS.Timeout
	skipApiVersionCheck?: boolean

	config: ConnectionConfig | undefined
	moduleInfo: ModuleVersionInfo | undefined
}

export class ModuleHost {
	readonly #logger = LogController.createLogger('Instance/ModuleHost')

	readonly #deps: InstanceModuleWrapperDependencies
	// readonly #modules: InstanceModules
	// readonly #connectionConfigStore: ConnectionConfigStore

	#children: Map<string, ModuleChild>

	constructor(deps: InstanceModuleWrapperDependencies) {
		this.#deps = deps
		// this.#modules = modules
		// this.#connectionConfigStore = connectionConfigStore

		// const cpuCount = os.cpus().length // An approximation
		// this.#startQueue = new PQueue({ concurrency: Math.max(cpuCount - 1, 1) })

		this.#children = new Map()
	}

	/**
	 * Bind events/initialise a connected child process
	 */
	#listenToModuleSocket(child: ModuleChild): void {
		const forceRestart = () => {
			// Force restart the connection, as it failed to initialise and will be broken
			child.restartCount++

			child.monitor?.off('exit', forceRestart)
			child.monitor?.off('message', initHandler)

			if (!child.delayStartUntil) {
				const sleepDuration = sleepStrategy(child.restartCount)

				child.state = ModuleChildState.INVALIDATED
				child.delayStartUntil = Date.now() + sleepDuration

				// Ensure the connection is checked around the delay time
				setTimeout(() => this.#triggerConnectionCheck(), sleepDuration)
			}

			// Stop it now
			child.monitor?.stop()
			child.handler?.cleanup()
			delete child.handler
		}

		const debugLogRoom = ConnectionDebugLogRoom(child.connectionId)

		const initHandler = (msg0: Serializable): void => {
			const msg = msg0 as Record<string, any>
			if (msg.direction === 'call' && msg.name === 'register' && msg.callbackId && msg.payload) {
				const { apiVersion, connectionId, verificationToken } = ejson.parse(msg.payload)
				if (!child.skipApiVersionCheck && !isModuleApiVersionCompatible(apiVersion)) {
					this.#logger.debug(`Got register for unsupported api version "${apiVersion}" connectionId: "${connectionId}"`)
					this.#deps.io.emitToRoom(
						debugLogRoom,
						debugLogRoom,
						'error',
						`Got register for unsupported api version "${apiVersion}"`
					)

					forceRestart()
					return
				}

				if (child.authToken !== verificationToken) {
					this.#logger.debug(`Got register with bad auth token for connectionId: "${connectionId}"`)
					forceRestart()
					return
				}

				if (!child.monitor || !child.monitor.child) {
					this.#logger.debug(`Got register with child not initialised: "${connectionId}"`)
					forceRestart()
					return
				}

				// Bind the event listeners
				child.handler = new SocketEventsHandler(this.#deps, child.monitor, connectionId, apiVersion)

				// Register successful
				// child.doWorkTask = registerResult.doWorkTask
				this.#logger.debug(`Registered module client "${connectionId}"`)

				const config = child.config
				if (!config) {
					this.#logger.verbose(`Missing config for instance "${connectionId}"`)
					forceRestart()
					return
				}
				// const moduleInfo = this.registry.instance.modules.known_modules[config.instance_type]
				// if (!moduleInfo) {
				// 	this.#logger.verbose(`Missing manifest for instance "${connectionId}"`)
				// 	forceRestart()
				// 	return
				// }

				// report success
				child.monitor.child.send({
					direction: 'response',
					callbackId: msg.callbackId,
					success: true,
					payload: ejson.stringify({}),
				})

				// TODO module-lib - start pings

				// Init module
				this.#deps.instanceStatus.updateInstanceStatus(connectionId, 'initializing', null)

				child.handler
					.init(config)
					.then(() => {
						child.restartCount = 0

						child.monitor?.off('message', initHandler)

						switch (child.state) {
							case ModuleChildState.INPROGRESS:
								child.state = ModuleChildState.RUNNING
								break
							case ModuleChildState.INPROGRESS_INVALIDATED:
								child.state = ModuleChildState.INVALIDATED
								this.#triggerConnectionCheck()
								break
							case ModuleChildState.INVALIDATED:
							case ModuleChildState.RUNNING:
								// Should never happen, leave it be as its the next stat in this cycle
								break
							default:
								assertNever(child.state)
								break
						}

						// mark child as ready to receive
						child.isReady = true

						// Inform action recorder
						this.#deps.controls.actionRecorder.connectionAvailabilityChange(connectionId, true)
					})
					.catch((e) => {
						this.#logger.warn(`Instance "${config.label || child.connectionId}" failed to init: ${e} ${e?.stack}`)
						this.#deps.io.emitToRoom(debugLogRoom, debugLogRoom, 'error', `Failed to init: ${e} ${e?.stack}`)

						forceRestart()
					})
			}
		}
		child.monitor?.on('message', initHandler)
		child.monitor?.on('exit', forceRestart)
	}

	/**
	 * Get a handle to an active instance
	 */
	getChild(
		connectionId: string,
		allowInitialising?: boolean
	): Omit<SocketEventsHandler, 'updateConfigAndLabel'> | undefined {
		const child = this.#children.get(connectionId)
		if (child && (child.isReady || allowInitialising)) {
			return child.handler
		} else {
			return undefined
		}
	}

	/**
	 * Resend feedbacks to all active instances.
	 * This will trigger a subscribe call for each feedback
	 */
	resubscribeAllFeedbacks(): void {
		for (const child of this.#children.values()) {
			if (child.handler && child.isReady) {
				child.handler.sendAllFeedbackInstances().catch((e) => {
					this.#logger.warn(`sendAllFeedbackInstances failed for "${child.connectionId}": ${e}`)
				})
			}
		}
	}

	/**
	 * Send a list of changed variables to all active instances.
	 * This will trigger feedbacks using variables to be rechecked
	 */
	onVariablesChanged(all_changed_variables_set: Set<string>): void {
		const changedVariableIds = Array.from(all_changed_variables_set)

		for (const child of this.#children.values()) {
			if (child.handler && child.isReady) {
				child.handler.sendVariablesChanged(changedVariableIds).catch((e) => {
					this.#logger.warn(`sendVariablesChanged failed for "${child.connectionId}": ${e}`)
				})
			}
		}
	}

	/**
	 * Stop all running instances
	 * @param timeout - time (integer seconds) to wait for the connections to stop
	 */
	async queueStopAllConnections(timeout = 10): Promise<void> {
		for (const child of this.#children.values()) {
			// Set the state to being stopped
			child.config = undefined
			child.moduleInfo = undefined

			// Update the state to invalidated
			switch (child.state) {
				case ModuleChildState.INPROGRESS:
					child.state = ModuleChildState.INPROGRESS_INVALIDATED
					break
				case ModuleChildState.INVALIDATED:
				case ModuleChildState.INPROGRESS_INVALIDATED:
					// Change already queued
					break
				case ModuleChildState.RUNNING:
					child.state = ModuleChildState.INVALIDATED
					break
				default:
					assertNever(child.state)
					break
			}
		}

		this.#triggerConnectionCheck()

		if (timeout <= 0) return

		// Wait for the connections to stop
		for (let i = 0; i < timeout; i++) {
			if (this.#children.size === 0) return

			await new Promise((resolve) => setTimeout(resolve, 1000))
		}
	}

	#triggerConnectionCheck = debounceFn(
		() => {
			for (const [connectionId, child] of this.#children) {
				if (child.state !== ModuleChildState.INVALIDATED) {
					// Already in progress, or nothing to do
					continue
				}

				child.state = ModuleChildState.INPROGRESS
				child.logger.debug(`Updating connection state`)
				this.#processConnectionState(connectionId, child).catch((e) => {
					child.logger.error(`Failed to process connection state: ${e}`)

					// TODO - better?
				})
			}
		},
		{
			before: false,
			after: true,
			maxWait: 50,
			wait: 10,
		}
	)

	async #processConnectionState(connectionId: string, child: ModuleChild): Promise<void> {
		if (!child.config || !child.moduleInfo) {
			child.logger.debug(`Stopping connection`)

			delete child.delayStartUntil

			// TODO - stop connection

			await this.#processStoppingConnection(connectionId, child).then(() => {
				if (child.state === ModuleChildState.INPROGRESS) {
					// mark connection as disabled
					this.#deps.instanceStatus.updateInstanceStatus(connectionId, null, 'Disabled')

					// Delete the child now that it is empty
					if (this.#children.get(connectionId)?.creationId === child.creationId) {
						this.#children.delete(connectionId)
					}
				} else if (child.state === ModuleChildState.INPROGRESS_INVALIDATED) {
					child.state = ModuleChildState.INVALIDATED
					this.#triggerConnectionCheck()
				} else {
					// Shouldn't get here, but make sure we don't get stuck
					child.logger.error(`Invalid state for connection: "${connectionId}"`)
					child.state = ModuleChildState.INVALIDATED
					this.#triggerConnectionCheck()
				}
			})
		} else {
			if (child.delayStartUntil && child.delayStartUntil > Date.now()) {
				// Skip as it is waiting for the delay
				return
			}
			delete child.delayStartUntil

			// TODO - when to use updateConfigAndLabel instead of a restart?

			await this.#processStartingConnection(connectionId, child).then(() => {
				// TODO
			})
		}
	}

	async #processStoppingConnection(_connectionId: string, child: ModuleChild): Promise<void> {
		// Ensure a new child cant register
		delete child.authToken

		child.isReady = false

		delete child.delayStartUntil

		if (child.handler) {
			// Perform cleanup of the module and event listeners
			try {
				await child.handler.destroy()
			} catch (e) {
				console.error(`Destroy failed: ${e}`)
			}
		}

		if (child.monitor) {
			// Stop the child process
			const monitor = child.monitor
			await new Promise<void>((resolve) => monitor.stop(resolve))
		}
	}

	async #processStartingConnection(connectionId: string, child: ModuleChild): Promise<boolean> {
		// Make sure the child is not already running
		await this.#processStoppingConnection(connectionId, child)

		const { moduleInfo, config } = child
		if (!moduleInfo || !config) {
			this.#logger.error(`Missing module info or config for connection: "${connectionId}"`)
			return false
		}

		this.#logger.info(`Starting connection: "${config.label}" (${connectionId})`)

		const parsedInfo = await checkModuleForCompatibility(moduleInfo, child.logger)
		if (!parsedInfo) {
			// Pretend this crashed, and delay a restart
			child.restartCount++
			const sleepDuration = sleepStrategy(child.restartCount)

			child.delayStartUntil = Date.now() + sleepDuration
			setTimeout(() => this.#triggerConnectionCheck(), sleepDuration)

			return false
		}

		const { nodePath, moduleApiVersion } = parsedInfo

		child.authToken = nanoid()
		child.skipApiVersionCheck = !moduleInfo.isPackaged

		const jsPath = path.join('companion', moduleInfo.manifest.runtime.entrypoint.replace(/\\/g, '/'))
		const jsFullPath = path.normalize(path.join(moduleInfo.basePath, jsPath))
		if (!(await fs.pathExists(jsFullPath))) {
			this.#logger.error(`Module entrypoint "${jsFullPath}" does not exist`)
			return false
		}

		// Allow running node with `--inspect`
		let inspectPort = undefined
		if (!moduleInfo.isPackaged) {
			try {
				const inspectFilePath = path.join(moduleInfo.basePath, 'DEBUG-INSPECT')
				const inspectFileStr = await fs.readFile(inspectFilePath)
				const inspectPortTmp = Number(inspectFileStr.toString().trim())
				if (!isNaN(inspectPortTmp)) inspectPort = inspectPortTmp
			} catch (e) {
				// Ignore
			}
		}

		const cmd: string[] = [
			nodePath,
			...getNodeJsPermissionArguments(moduleInfo.manifest, moduleApiVersion, moduleInfo.basePath),
			inspectPort !== undefined ? `--inspect=${inspectPort}` : undefined,
			jsPath,
		].filter((v): v is string => !!v)
		this.#logger.silly(`Connection "${config.label}" command: ${JSON.stringify(cmd)}`)

		const monitor = new RespawnMonitor(cmd, {
			// name: `Connection "${config.label}"(${connectionId})`,
			env: {
				CONNECTION_ID: connectionId,
				VERIFICATION_TOKEN: child.authToken,
				MODULE_MANIFEST: 'companion/manifest.json',
			},
			maxRestarts: -1,
			kill: 5000,
			cwd: moduleInfo.basePath,
			fork: false,
			stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
		})

		const debugLogRoom = ConnectionDebugLogRoom(connectionId)
		this.#deps.io.emitToRoom(
			debugLogRoom,
			debugLogRoom,
			'system',
			`** Starting Connection from "${path.join(moduleInfo.basePath, jsPath)}" **`
		)

		monitor.on('start', () => {
			child.isReady = false
			child.handler?.cleanup()

			this.#logger.debug(`Connection "${config.label}" started`)
			this.#deps.io.emitToRoom(debugLogRoom, debugLogRoom, 'system', '** Connection started **')
		})
		monitor.on('stop', () => {
			child.isReady = false
			child.handler?.cleanup()

			this.#deps.instanceStatus.updateInstanceStatus(
				connectionId,
				child.delayStartUntil ? 'crashed' : null,
				child.delayStartUntil ? '' : 'Stopped'
			)
			this.#logger.debug(`Connection "${config.label}" stopped`)
			this.#deps.io.emitToRoom(debugLogRoom, debugLogRoom, 'system', '** Connection stopped **')

			this.#deps.controls.actionRecorder.connectionAvailabilityChange(connectionId, false)
		})
		monitor.on('crash', () => {
			child.isReady = false
			child.handler?.cleanup()

			this.#deps.instanceStatus.updateInstanceStatus(connectionId, null, 'Crashed')
			this.#logger.debug(`Connection "${config.label}" crashed`)
			this.#deps.io.emitToRoom(debugLogRoom, debugLogRoom, 'system', '** Connection crashed **')
		})
		monitor.on('stdout', (data) => {
			if (moduleInfo.versionId === 'dev') {
				// Only show stdout for modules which are being developed
				child.logger.verbose(`stdout: ${data.toString()}`)
			}

			if (this.#deps.io.countRoomMembers(debugLogRoom) > 0) {
				this.#deps.io.emitToRoom(debugLogRoom, debugLogRoom, 'console', data.toString())
			}
		})
		monitor.on('stderr', (data) => {
			child.logger.verbose(`stderr: ${data.toString()}`)
			if (this.#deps.io.countRoomMembers(debugLogRoom) > 0) {
				this.#deps.io.emitToRoom(debugLogRoom, debugLogRoom, 'error', data.toString())
			}
		})

		child.monitor = monitor

		this.#listenToModuleSocket(child)

		// Start the child
		child.monitor.start()

		return true
	}

	/**
	 * Update the running status of a connection
	 */
	queueUpdateConnection(
		connectionId: string,
		config: ConnectionConfig | undefined,
		moduleInfo: ModuleVersionInfo | undefined
	): void {
		let child = this.#children.get(connectionId)
		if (!child) {
			if (!config || !moduleInfo) {
				this.#logger.debug(`Connection already stopped: "${connectionId}"`)
				// No child and the request was to stop the child, so nothing to do
				return
			} else {
				// Create a new child entry
				child = {
					creationId: nanoid(),
					connectionId,
					state: ModuleChildState.INVALIDATED,
					isReady: false,
					logger: LogController.createLogger(`Instance/${config.label}`),
					restartCount: 0,

					config,
					moduleInfo,
				}
				this.#children.set(connectionId, child)
			}
		}

		// Update the target config
		child.config = config
		child.moduleInfo = moduleInfo

		if (config) child.logger = LogController.createLogger(`Instance/${config.label}`)

		switch (child.state) {
			case ModuleChildState.INVALIDATED:
			case ModuleChildState.INPROGRESS_INVALIDATED:
				// A state change is already queued
				break
			case ModuleChildState.INPROGRESS:
				// A state change is already in progress
				child.state = ModuleChildState.INPROGRESS_INVALIDATED
				break
			case ModuleChildState.RUNNING:
				// The connection is already running, so just update the config
				child.state = ModuleChildState.INVALIDATED
				break
			default:
				assertNever(child.state)
				break
		}

		this.#triggerConnectionCheck()
	}

	async connectionEntityUpdate(entityModel: SomeEntityModel, controlId: string): Promise<boolean> {
		const connection = this.getChild(entityModel.connectionId, true)
		if (!connection) return false

		await connection.entityUpdate(entityModel, controlId)

		return true
	}
	async connectionEntityDelete(entityModel: SomeEntityModel, _controlId: string): Promise<boolean> {
		const connection = this.getChild(entityModel.connectionId, true)
		if (!connection) return false

		await connection.entityDelete(entityModel)

		return true
	}
	async connectionEntityLearnOptions(
		entityModel: SomeEntityModel,
		controlId: string
	): Promise<CompanionOptionValues | undefined | void> {
		const connection = this.getChild(entityModel.connectionId)
		if (!connection) return undefined

		return connection.entityLearnValues(entityModel, controlId)
	}
}

async function checkModuleForCompatibility(
	moduleInfo: ModuleVersionInfo,
	logger: Logger
): Promise<{ nodePath: string; moduleApiVersion: string } | false> {
	if (moduleInfo.manifest.runtime.api !== 'nodejs-ipc') {
		logger.error(`Only nodejs-ipc api is supported currently`)
		return false
	}

	const nodePath = await getNodeJsPath(moduleInfo.manifest.runtime.type)
	if (!nodePath) {
		logger.error(`Runtime "${moduleInfo.manifest.runtime.type}" is not supported in this version of Companion`)
		return false
	}

	// Determine the module api version
	let moduleApiVersion = moduleInfo.manifest.runtime.apiVersion
	if (!moduleInfo.isPackaged) {
		// When not packaged, lookup the version from the library itself
		try {
			const moduleLibPackagePath = require.resolve('@companion-module/base/package.json', {
				paths: [moduleInfo.basePath],
			})
			const moduleLibPackage = require(moduleLibPackagePath)
			moduleApiVersion = moduleLibPackage.version
		} catch (e) {
			logger.error(`Failed to get module api version: ${e}`)
			return false
		}
	}

	if (!isModuleApiVersionCompatible(moduleApiVersion)) {
		logger.error(`Module Api version is too new/old: ${moduleApiVersion}`)
		return false
	}

	return { nodePath, moduleApiVersion }
}
