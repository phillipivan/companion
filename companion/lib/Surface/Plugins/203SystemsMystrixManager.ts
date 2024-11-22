import type { SurfacePanel } from '../Types.js'
import type { SurfacePluginBase, SurfacePluginProps } from './Base.js'
import LogController from '../../Log/Controller.js'
import { SurfaceUSB203SystemsMystrix } from './203SystemsMystrix.js'
import { OpenSurfacesManager } from './Util.js'
import { devicesAsync, Device as HidDeviceInfo } from 'node-hid'

export type SurfacePlugin203SystemsMystrixConfig = null

export class SurfacePlugin203SystemsMystrixManager implements SurfacePluginBase<SurfacePlugin203SystemsMystrixConfig> {
	readonly #logger = LogController.createLogger('Surface/Plugin/203SystemsMystrixManager')

	readonly DefaultConfig: SurfacePlugin203SystemsMystrixConfig = null

	// #config: SurfacePlugin203SystemsMystrixConfig = cloneDeep(this.DefaultConfig)

	// #props: SurfacePluginProps

	constructor(_props: SurfacePluginProps) {
		// this.#props = props
	}

	readonly #openSurfaces = new OpenSurfacesManager<SurfaceUSB203SystemsMystrix>()

	async refreshSurfaces(): Promise<SurfacePanel[]> {
		const hidDevices = await devicesAsync()

		const openedSurfaces = await Promise.all(
			hidDevices.map(async (candidate) => {
				if (!candidate.path) return null

				if (!is203SystemsMystrix(candidate)) return null

				const path = candidate.path
				this.#logger.silly(`opening device ${path}`)

				return this.#openSurfaces
					.tryOpeningWithHidAccessCheck(path, async () => SurfaceUSB203SystemsMystrix.create(path))
					.catch((e) => {
						this.#logger.error(`Failed to open 203Systems Mystrix: ${e?.message ?? e}`)
					})
			})
		)

		return openedSurfaces.filter((v) => !!v)
	}

	detectedSurfaces(devices: Array<unknown>): Promise<SurfacePanel[]> {
		throw new Error('Method not implemented.')
	}

	updateConfig(_config: SurfacePlugin203SystemsMystrixConfig): void {
		// const oldConfig = this.#config
		// this.#config = config
		// TODO - react to change
	}
}

function is203SystemsMystrix(deviceInfo: HidDeviceInfo): boolean {
	return (
		deviceInfo.vendorId === 0x0203 && // 203 Systems
		(deviceInfo.productId & 0xffc0) == 0x1040 && // Mystrix
		deviceInfo.usagePage === 0xff00 && // rawhid interface
		deviceInfo.usage === 0x01
	)
}
