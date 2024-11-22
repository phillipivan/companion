import type { SurfacePanel } from '../Types.js'
import type { SurfacePluginBase, SurfacePluginProps } from './Base.js'
import LogController from '../../Log/Controller.js'
import { SurfaceUSBContourShuttle } from './ContourShuttle.js'
import { OpenSurfacesManager } from './Util.js'
import { cloneDeep } from 'lodash-es'
import { devicesAsync, Device as HidDeviceInfo } from 'node-hid'
import shuttleControlUSB from 'shuttle-control-usb'

export interface SurfacePluginContourShuttleConfig {
	enable: boolean // TODO - convert from contour_shuttle_enable
}

export class SurfacePluginContourShuttleManager implements SurfacePluginBase<SurfacePluginContourShuttleConfig> {
	readonly #logger = LogController.createLogger('Surface/Plugin/ContourShuttleManager')

	readonly DefaultConfig: SurfacePluginContourShuttleConfig = {
		enable: false,
	}

	#config: SurfacePluginContourShuttleConfig = cloneDeep(this.DefaultConfig)

	// readonly #props: SurfacePluginProps

	constructor(_props: SurfacePluginProps) {
		// this.#props = props
	}

	readonly #openSurfaces = new OpenSurfacesManager<SurfaceUSBContourShuttle>()

	async refreshSurfaces(): Promise<SurfacePanel[]> {
		if (!this.#config.enable) return []

		const hidDevices = await devicesAsync()

		const openedSurfaces = await Promise.all(
			hidDevices.map(async (candidate) => {
				if (!candidate.path) return null

				if (!isContourShuttle(candidate)) return null

				const path = candidate.path
				this.#logger.silly(`opening device ${path}`)

				return this.#openSurfaces
					.tryOpeningWithHidAccessCheck(path, async () => SurfaceUSBContourShuttle.create(path))
					.catch((e) => {
						this.#logger.error(`Failed to open Contour Shuttle: ${e?.message ?? e}`)
					})
			})
		)

		return openedSurfaces.filter((v) => !!v)
	}

	updateConfig(config: SurfacePluginContourShuttleConfig): void {
		// const oldConfig = this.#config
		this.#config = config
		// TODO - react to change
	}
}

function isContourShuttle(deviceInfo: HidDeviceInfo): boolean {
	return (
		deviceInfo.vendorId === shuttleControlUSB.vids.CONTOUR &&
		(deviceInfo.productId === shuttleControlUSB.pids.SHUTTLEXPRESS ||
			deviceInfo.productId === shuttleControlUSB.pids.SHUTTLEPRO_V1 ||
			deviceInfo.productId === shuttleControlUSB.pids.SHUTTLEPRO_V2)
	)
}
