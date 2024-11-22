import type { SurfacePanel } from '../Types.js'
import type { SurfacePluginBase, SurfacePluginProps } from './Base.js'
import LogController from '../../Log/Controller.js'
import { SurfaceUSBBlackmagicController } from './BlackmagicController.js'
import { OpenSurfacesManager } from './Util.js'
import { cloneDeep } from 'lodash-es'
import { listBlackmagicControllers } from '@blackmagic-controller/node'

export interface SurfacePluginBlackmagicControllerConfig {
	enable: boolean // TODO - convert from blackmagic_controller_enable
}

export class SurfacePluginBlackmagicControllerManager
	implements SurfacePluginBase<SurfacePluginBlackmagicControllerConfig>
{
	readonly #logger = LogController.createLogger('Surface/Plugin/BlackmagicControllerManager')

	readonly DefaultConfig: SurfacePluginBlackmagicControllerConfig = {
		enable: false,
	}

	#config: SurfacePluginBlackmagicControllerConfig = cloneDeep(this.DefaultConfig)

	readonly #props: SurfacePluginProps

	constructor(props: SurfacePluginProps) {
		this.#props = props
	}

	readonly #openSurfaces = new OpenSurfacesManager<SurfaceUSBBlackmagicController>()

	async refreshSurfaces(): Promise<SurfacePanel[]> {
		if (!this.#config.enable) return []

		const candidateDevices = await listBlackmagicControllers()

		const openedSurfaces = await Promise.all(
			candidateDevices.map(async (candidate) => {
				const path = candidate.path
				this.#logger.silly(`opening device ${path}`)

				return this.#openSurfaces
					.tryOpeningWithHidAccessCheck(path, async () =>
						SurfaceUSBBlackmagicController.create(path, {
							executeExpression: this.#props.executeExpression,
						})
					)
					.catch((e) => {
						this.#logger.error(`Failed to open Blackmagic Controller: ${e?.message ?? e}`)
					})
			})
		)

		return openedSurfaces.filter((v) => !!v)
	}

	detectedSurfaces(devices: Array<unknown>): Promise<SurfacePanel[]> {
		throw new Error('Method not implemented.')
	}

	updateConfig(config: SurfacePluginBlackmagicControllerConfig): void {
		// const oldConfig = this.#config
		this.#config = config
		// TODO - react to change
	}
}
