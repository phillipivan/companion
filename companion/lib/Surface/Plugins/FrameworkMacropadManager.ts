import type { SurfacePanel } from '../Types.js'
import type { SurfacePluginBase, SurfacePluginProps } from './Base.js'
import LogController from '../../Log/Controller.js'
import { SurfaceUSBFrameworkMacropad } from '../USB/FrameworkMacropad.js'
import { OpenSurfacesManager } from './Util.js'
import { devicesAsync, Device as HidDeviceInfo } from 'node-hid'

export type SurfacePluginFrameworkMacropadConfig = null

export class SurfacePluginFrameworkMacropadManager implements SurfacePluginBase<SurfacePluginFrameworkMacropadConfig> {
	readonly #logger = LogController.createLogger('Surface/Plugin/FrameworkMacropadManager')

	readonly DefaultConfig: SurfacePluginFrameworkMacropadConfig = null

	// #config: SurfacePluginFrameworkMacropadConfig = cloneDeep(this.DefaultConfig)

	// #props: SurfacePluginProps

	constructor(_props: SurfacePluginProps) {
		// this.#props = props
	}

	readonly #openSurfaces = new OpenSurfacesManager<SurfaceUSBFrameworkMacropad>()

	async refreshSurfaces(): Promise<SurfacePanel[]> {
		const hidDevices = await devicesAsync()

		const openedSurfaces = await Promise.all(
			hidDevices.map(async (candidate) => {
				if (!candidate.path) return null

				if (!isFrameworkMacropad(candidate)) return null

				const path = candidate.path
				this.#logger.silly(`opening device ${path}`)

				return this.#openSurfaces
					.tryOpeningWithHidAccessCheck(path, async () => SurfaceUSBFrameworkMacropad.create(path))
					.catch((e) => {
						this.#logger.error(`Failed to open Framework Macropad: ${e?.message ?? e}`)
					})
			})
		)

		return openedSurfaces.filter((v) => !!v)
	}

	detectedSurfaces(devices: Array<unknown>): Promise<SurfacePanel[]> {
		throw new Error('Method not implemented.')
	}

	updateConfig(_config: SurfacePluginFrameworkMacropadConfig): void {
		// const oldConfig = this.#config
		// this.#config = config
		// TODO - react to change
	}
}

function isFrameworkMacropad(deviceInfo: HidDeviceInfo): boolean {
	return (
		deviceInfo.vendorId === 0x32ac && // frame.work
		deviceInfo.productId === 0x0013 && // macropod
		deviceInfo.usagePage === 0xffdd && // rawhid interface
		deviceInfo.usage === 0x61
	)
}
