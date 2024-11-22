import type { SurfacePanel } from '../Types.js'
import type { SurfacePluginBase, SurfacePluginProps } from './Base.js'
import LogController from '../../Log/Controller.js'
import { SurfaceUSBXKeys } from './XKeys.js'
import { OpenSurfacesManager } from './Util.js'
import { cloneDeep } from 'lodash-es'
import { devicesAsync, Device as HidDeviceInfo } from 'node-hid'
import { XKeys } from 'xkeys'

export interface SurfacePluginXKeysConfig {
	enable: boolean // TODO - convert from xkeys_enable
	legacyLayout: boolean // TODO - convert from xkeys_legacy_layout
}

export class SurfacePluginXKeysManager implements SurfacePluginBase<SurfacePluginXKeysConfig> {
	readonly #logger = LogController.createLogger('Surface/Plugin/XKeysManager')

	readonly DefaultConfig: SurfacePluginXKeysConfig = {
		enable: false,
		legacyLayout: false,
	}

	#config: SurfacePluginXKeysConfig = cloneDeep(this.DefaultConfig)

	readonly #props: SurfacePluginProps

	constructor(props: SurfacePluginProps) {
		this.#props = props
	}

	readonly #openSurfaces = new OpenSurfacesManager<SurfaceUSBXKeys>()

	async refreshSurfaces(): Promise<SurfacePanel[]> {
		if (!this.#config.enable) return []

		const hidDevices = await devicesAsync()

		const openedSurfaces = await Promise.all(
			hidDevices.map(async (candidate) => {
				if (!candidate.path) return null

				if (!isXKeys(candidate)) return null

				const path = candidate.path
				this.#logger.silly(`opening device ${path}`)

				return this.#openSurfaces
					.tryOpeningWithHidAccessCheck(path, async () =>
						SurfaceUSBXKeys.create(path, {
							useLegacyLayout: this.#config.legacyLayout,
							executeExpression: this.#props.executeExpression,
						})
					)
					.catch((e) => {
						this.#logger.error(`Failed to open Contour Shuttle: ${e?.message ?? e}`)
					})
			})
		)

		return openedSurfaces.filter((v) => !!v)
	}

	updateConfig(config: SurfacePluginXKeysConfig): void {
		// const oldConfig = this.#config
		this.#config = config
		// TODO - react to change
	}
}

function isXKeys(deviceInfo: HidDeviceInfo): boolean {
	return deviceInfo.vendorId === XKeys.vendorId && deviceInfo.interface === 0
}
