import { nanoid } from 'nanoid'
import LogController from '../Log/Controller.js'
import { DEFAULT_TCP_PORT } from '@elgato-stream-deck/tcp'
import type { SurfaceController } from './Controller.js'
import type { DataDatabase } from '../Data/Database.js'
import type { UIHandler, ClientSocket } from '../UI/Handler.js'
import type { OutboundSurfaceInfo, OutboundSurfacesUpdateRemoveOp } from '@companion-app/shared/Model/Surfaces.js'
import { SurfaceOutboundPluginBase } from './Plugins/Base.js'
import { SurfacePluginElgatoStreamDeckOutboundManager } from './Plugins/ElgatoStreamDeckOutboundManager.js'

const OutboundSurfacesRoom = 'surfaces:outbound'

export class SurfaceOutboundController {
	/**
	 * The logger for this class
	 */
	readonly #logger = LogController.createLogger('SurfaceOutboundController')

	readonly #controller: SurfaceController

	/**
	 * The core database library
	 */
	readonly #db: DataDatabase

	/**
	 * The core interface client
	 */
	readonly #io: UIHandler

	#storage: Record<string, OutboundSurfaceInfo> = {}

	readonly #outboundPlugins = new Map<string, SurfaceOutboundPluginBase<any>>()

	constructor(controller: SurfaceController, db: DataDatabase, io: UIHandler) {
		this.#controller = controller
		this.#db = db
		this.#io = io

		// TODO - initial config
		this.#registerPlugin('elgato', new SurfacePluginElgatoStreamDeckOutboundManager())
	}

	#registerPlugin(pluginType: string, plugin: SurfaceOutboundPluginBase<any>): void {
		plugin.on('connected', (panel) => {
			this.#controller.createSurfaceHandler(panel.info.deviceId, `${pluginType}-outbound`, panel)
		})
		this.#outboundPlugins.set(pluginType, plugin)
	}

	#saveToDb() {
		this.#db.setKey('outbound_surfaces', this.#storage)
	}

	/**
	 * Initialize the module, loading the configuration from the db
	 * @access public
	 */
	init(): void {
		this.#storage = this.#db.getKey('outbound_surfaces', {})

		for (const surfaceInfo of Object.values(this.#storage)) {
			try {
				const plugin = this.#outboundPlugins.get(surfaceInfo.type)
				if (plugin) {
					plugin.connectTo(surfaceInfo.address, surfaceInfo.port)
				} else {
					throw new Error(`Remote surface type "${surfaceInfo.type}" is not supported`)
				}
			} catch (e) {
				this.#logger.error(`Unable to setup remote surface at ${surfaceInfo.address}:${surfaceInfo.port}: ${e}`)
			}
		}
	}

	/**
	 * Setup a new socket client's events
	 */
	clientConnect(client: ClientSocket): void {
		client.onPromise('surfaces:outbound:subscribe', async () => {
			client.join(OutboundSurfacesRoom)

			return this.#storage
		})
		client.onPromise('surfaces:outbound:unsubscribe', async () => {
			client.leave(OutboundSurfacesRoom)
		})
		client.onPromise('surfaces:outbound:add', async (type, address, port, name) => {
			const plugin = this.#outboundPlugins.get(type)
			if (!plugin) throw new Error(`Surface type "${type}" is not supported`)

			// Ensure port number is defined
			if (!port) port = DEFAULT_TCP_PORT

			// check for duplicate
			const existingAddressAndPort = Object.values(this.#storage).find(
				(surfaceInfo) => surfaceInfo.address === address && surfaceInfo.port === port
			)
			if (existingAddressAndPort) throw new Error('Specified address and port is already defined')

			this.#logger.info(`Adding new Remote Streamdeck at ${address}:${port} (${name})`)

			const id = nanoid()
			const newInfo: OutboundSurfaceInfo = {
				id,
				type: 'elgato',
				address,
				port,
				displayName: name ?? '',
			}
			this.#storage[id] = newInfo
			this.#saveToDb()

			this.#io.emitToRoom(OutboundSurfacesRoom, 'surfaces:outbound:update', [
				{
					type: 'add',
					itemId: id,

					info: newInfo,
				},
			])

			plugin.connectTo(newInfo.address, newInfo.port)

			return id
		})

		client.onPromise('surfaces:outbound:remove', async (id) => {
			const surfaceInfo = this.#storage[id]
			if (!surfaceInfo) return // Not found, pretend all was ok

			delete this.#storage[id]
			this.#saveToDb()

			this.#io.emitToRoom(OutboundSurfacesRoom, 'surfaces:outbound:update', [
				{
					type: 'remove',
					itemId: id,
				},
			])

			const plugin = this.#outboundPlugins.get(surfaceInfo.type)

			if (plugin) {
				plugin.disconnectFrom(surfaceInfo.address, surfaceInfo.port)
			} else {
				this.#logger.warn(`Unable to remove remote surface at ${surfaceInfo.address}:${surfaceInfo.port}`)
			}
		})

		client.onPromise('surfaces:outbound:set-name', async (id, name) => {
			const surfaceInfo = this.#storage[id]
			if (!surfaceInfo) throw new Error('Surface not found')

			surfaceInfo.displayName = name ?? ''
			this.#saveToDb()

			this.#io.emitToRoom(OutboundSurfacesRoom, 'surfaces:outbound:update', [
				{
					type: 'add',
					itemId: id,

					info: surfaceInfo,
				},
			])
		})
	}

	reset(): void {
		for (const plugin of this.#outboundPlugins.values()) {
			plugin.disconnectFromAll()
		}

		const ops: OutboundSurfacesUpdateRemoveOp[] = Object.keys(this.#storage).map((id) => ({
			type: 'remove',
			itemId: id,
		}))
		if (ops.length > 0) {
			this.#io.emitToRoom(OutboundSurfacesRoom, 'surfaces:outbound:update', ops)
		}

		this.#storage = {}
		this.#saveToDb()
	}

	quit(): void {
		for (const plugin of this.#outboundPlugins.values()) {
			plugin.disconnectFromAll()
		}
	}
}
