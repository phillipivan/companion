import type { SurfacePanel } from '../Types.js'
import type { SurfacePluginBase, SurfacePluginProps } from './Base.js'
import LogController from '../../Log/Controller.js'
import findProcess from 'find-process'
import { listStreamDecks } from '@elgato-stream-deck/node'
import { SurfaceUSBElgatoStreamDeck } from '../USB/ElgatoStreamDeck.js'
import { OpenSurfacesManager } from './Util.js'
import { cloneDeep } from 'lodash-es'

export interface SurfacePluginElgatoStreamDeckConfig {
	elgato_plugin_enable: boolean
}

export class SurfacePluginElgatoStreamDeckManager implements SurfacePluginBase<SurfacePluginElgatoStreamDeckConfig> {
	readonly #logger = LogController.createLogger('Surface/Plugin/ElgatoStreamDeckManager')

	readonly DefaultConfig: SurfacePluginElgatoStreamDeckConfig = {
		elgato_plugin_enable: false,
	}

	#config: SurfacePluginElgatoStreamDeckConfig = cloneDeep(this.DefaultConfig)

	// #props: SurfacePluginProps

	constructor(_props: SurfacePluginProps) {
		// this.#props = props
	}

	readonly #openSurfaces = new OpenSurfacesManager<SurfaceUSBElgatoStreamDeck>()

	async refreshSurfaces(): Promise<SurfacePanel[]> {
		const streamdeckDisabled = this.#config.elgato_plugin_enable
		if (streamdeckDisabled) return []

		const isStreamDeckSoftwareRunning = await this.#isStreamDeckSoftwareRunning()
		if (isStreamDeckSoftwareRunning) return []

		const candidateStreamDecks = await listStreamDecks()

		const openedSurfaces = await Promise.all(
			candidateStreamDecks.map(async (candidate) => {
				this.#logger.silly(`opening device ${candidate.path}`)

				return this.#openSurfaces
					.tryOpeningWithHidAccessCheck(candidate.path, async () => SurfaceUSBElgatoStreamDeck.create(candidate.path))
					.catch((e) => {
						this.#logger.error(`Failed to open Stream Deck: ${e}`)
					})
			})
		)

		return openedSurfaces.filter((v) => !!v)
	}

	updateConfig(config: SurfacePluginElgatoStreamDeckConfig): void {
		// const oldConfig = this.#config
		this.#config = config

		// TODO - react to change
	}

	async #isStreamDeckSoftwareRunning() {
		try {
			// Make sure we don't try to take over stream deck devices when the stream deck application
			// is running on windows.
			if (process.platform === 'win32') {
				const list = await findProcess('name', 'Stream Deck')
				if (typeof list === 'object' && list.length > 0) {
					this.#logger.silly('Elgato software detected, ignoring stream decks')
					return true
				}
			}
		} catch (e) {
			// scan for all usb devices anyways
		}

		return false
	}
}
