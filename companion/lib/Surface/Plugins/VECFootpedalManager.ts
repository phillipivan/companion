import type { SurfacePanel } from '../Types.js'
import type { SurfacePluginBase, SurfacePluginProps } from './Base.js'
import LogController from '../../Log/Controller.js'
import { SurfaceUSBVECFootpedal } from './VECFootpedal.js'
import { OpenSurfacesManager } from './Util.js'
import { devicesAsync, Device as HidDeviceInfo } from 'node-hid'
import { cloneDeep } from 'lodash-es'
import vecFootpedal from 'vec-footpedal'

export interface SurfacePluginVECFootpedalConfig {
	enable: boolean
}

export class SurfacePluginVECFootpedalManager implements SurfacePluginBase<SurfacePluginVECFootpedalConfig> {
	readonly #logger = LogController.createLogger('Surface/Plugin/VECFootpedalManager')

	readonly DefaultConfig: SurfacePluginVECFootpedalConfig = {
		enable: false,
	}

	#config: SurfacePluginVECFootpedalConfig = cloneDeep(this.DefaultConfig)

	// #props: SurfacePluginProps

	constructor(_props: SurfacePluginProps) {
		// this.#props = props
	}

	readonly #openSurfaces = new OpenSurfacesManager<SurfaceUSBVECFootpedal>()

	async refreshSurfaces(): Promise<SurfacePanel[]> {
		if (!this.#config.enable) return []

		const hidDevices = await devicesAsync()

		const openedSurfaces = await Promise.all(
			hidDevices.map(async (candidate) => {
				if (!candidate.path) return null

				if (!isVECFootpedal(candidate)) return null

				const path = candidate.path
				this.#logger.silly(`opening device ${path}`)

				return this.#openSurfaces
					.tryOpeningWithHidAccessCheck(path, async () => SurfaceUSBVECFootpedal.create(path))
					.catch((e) => {
						this.#logger.error(`Failed to open VEC Footpedal: ${e?.message ?? e}`)
					})
			})
		)

		return openedSurfaces.filter((v) => !!v)
	}

	updateConfig(config: SurfacePluginVECFootpedalConfig): void {
		// const oldConfig = this.#config
		this.#config = config
		// TODO - react to change
	}
}

function isVECFootpedal(deviceInfo: HidDeviceInfo): boolean {
	return deviceInfo.vendorId === vecFootpedal.vids.VEC && deviceInfo.productId === vecFootpedal.pids.FOOTPEDAL
}
