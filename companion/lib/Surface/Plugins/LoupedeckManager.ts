import type { SurfacePanel } from '../Types.js'
import type { SurfacePluginBase, SurfacePluginProps } from './Base.js'
import LogController from '../../Log/Controller.js'
import { OpenSurfacesManager } from './Util.js'
import { cloneDeep } from 'lodash-es'
import { listLoupedecks, LoupedeckModelId } from '@loupedeck/node'
import { assertNever } from '@companion-module/base'
import { SurfaceUSBLoupedeckLive } from './LoupedeckLive.js'
import { SurfaceUSBLoupedeckCt } from './LoupedeckCt.js'

export interface SurfacePluginLoupedeckConfig {
	enable: boolean // TODO - migrate from loupedeck_enable
}

export class SurfacePluginLoupedeckManager implements SurfacePluginBase<SurfacePluginLoupedeckConfig> {
	readonly #logger = LogController.createLogger('Surface/Plugin/LoupedeckManager')

	readonly DefaultConfig: SurfacePluginLoupedeckConfig = {
		enable: false,
	}

	#config: SurfacePluginLoupedeckConfig = cloneDeep(this.DefaultConfig)

	// #props: SurfacePluginProps

	constructor(_props: SurfacePluginProps) {
		// this.#props = props
	}

	readonly #openSurfaces = new OpenSurfacesManager<SurfaceUSBLoupedeckCt | SurfaceUSBLoupedeckLive>()

	async refreshSurfaces(): Promise<SurfacePanel[]> {
		if (!this.#config.enable) return []

		const candidateLoupedecks = await listLoupedecks()

		const openedSurfaces = await Promise.all(
			candidateLoupedecks.map(async (deviceInfo) => {
				this.#logger.silly(`opening device ${deviceInfo.path}`)

				return this.#openSurfaces
					.tryOpeningWithHidAccessCheck(deviceInfo.path, async () => {
						if (
							deviceInfo.model === LoupedeckModelId.LoupedeckLive ||
							deviceInfo.model === LoupedeckModelId.LoupedeckLiveS ||
							deviceInfo.model === LoupedeckModelId.RazerStreamController ||
							deviceInfo.model === LoupedeckModelId.RazerStreamControllerX
						) {
							return SurfaceUSBLoupedeckLive.create(deviceInfo.path)
						} else if (
							deviceInfo.model === LoupedeckModelId.LoupedeckCt ||
							deviceInfo.model === LoupedeckModelId.LoupedeckCtV1
						) {
							return SurfaceUSBLoupedeckCt.create(deviceInfo.path)
						} else {
							assertNever(deviceInfo.model)
							throw new Error(`Unsupported Loupedeck model: ${deviceInfo.model}`)
						}
					})
					.catch((e) => {
						this.#logger.error(`Failed to open Stream Deck: ${e}`)
					})
			})
		)

		return openedSurfaces.filter((v) => !!v)
	}

	updateConfig(config: SurfacePluginLoupedeckConfig): void {
		// const oldConfig = this.#config
		this.#config = config

		// TODO - react to change
	}
}
