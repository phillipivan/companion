import type { SurfacePanel } from '../Types.js'
import type { SurfacePluginBase, SurfacePluginProps } from './Base.js'
import LogController from '../../Log/Controller.js'
import { SurfaceUSBInfinitton } from './Infinitton.js'
import { OpenSurfacesManager } from './Util.js'
import { devicesAsync, Device as HidDeviceInfo } from 'node-hid'

export type SurfacePluginInfinittonConfig = null

export class SurfacePluginInfinittonManager implements SurfacePluginBase<SurfacePluginInfinittonConfig> {
	readonly #logger = LogController.createLogger('Surface/Plugin/InfinittonManager')

	readonly DefaultConfig: SurfacePluginInfinittonConfig = null

	// #config: SurfacePluginInfinittonConfig = cloneDeep(this.DefaultConfig)

	// #props: SurfacePluginProps

	constructor(_props: SurfacePluginProps) {
		// this.#props = props
	}

	readonly #openSurfaces = new OpenSurfacesManager<SurfaceUSBInfinitton>()

	async refreshSurfaces(): Promise<SurfacePanel[]> {
		const hidDevices = await devicesAsync()

		const openedSurfaces = await Promise.all(
			hidDevices.map(async (candidate) => {
				if (!candidate.path) return null

				if (!isInfinitton(candidate)) return null

				const path = candidate.path
				this.#logger.silly(`opening device ${path}`)

				return this.#openSurfaces
					.tryOpeningWithHidAccessCheck(path, async () => SurfaceUSBInfinitton.create(path))
					.catch((e) => {
						this.#logger.error(`Failed to open Infinitton: ${e?.message ?? e}`)
					})
			})
		)

		return openedSurfaces.filter((v) => !!v)
	}

	detectedSurfaces(devices: Array<unknown>): Promise<SurfacePanel[]> {
		throw new Error('Method not implemented.')
	}

	updateConfig(_config: SurfacePluginInfinittonConfig): void {
		// const oldConfig = this.#config
		// this.#config = config
		// TODO - react to change
	}
}

function isInfinitton(deviceInfo: HidDeviceInfo): boolean {
	return deviceInfo.vendorId === 0xffff && (deviceInfo.productId === 0x1f40 || deviceInfo.productId === 0x1f41)
}
