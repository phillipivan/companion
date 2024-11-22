import type { SurfaceOutboundPluginBase, SurfaceOutboundPluginEvents } from './Base.js'
import LogController from '../../Log/Controller.js'
import { StreamDeckJpegOptions, SurfaceUSBElgatoStreamDeck } from './ElgatoStreamDeck.js'
import { StreamDeckTcpConnectionManager } from '@elgato-stream-deck/tcp'
import { EventEmitter } from 'events'

export type SurfacePluginElgatoStreamDeckOutboundConfig = null

export class SurfacePluginElgatoStreamDeckOutboundManager
	extends EventEmitter<SurfaceOutboundPluginEvents>
	implements SurfaceOutboundPluginBase<SurfacePluginElgatoStreamDeckOutboundConfig>
{
	readonly #logger = LogController.createLogger('Surface/Plugin/ElgatoStreamDeckOutboundManager')

	readonly DefaultConfig: SurfacePluginElgatoStreamDeckOutboundConfig = null

	// #config: SurfacePluginElgatoStreamDeckOutboundConfig = cloneDeep(this.DefaultConfig)

	#streamdeckManager = new StreamDeckTcpConnectionManager({
		jpegOptions: StreamDeckJpegOptions,
		autoConnectToSecondaries: true,
	})

	constructor() {
		super()

		// @ts-ignore why is this failing?
		this.#streamdeckManager.on('connected', (streamdeck) => {
			this.#logger.info(
				`Connected to TCP Streamdeck ${streamdeck.remoteAddress}:${streamdeck.remotePort} (${streamdeck.PRODUCT_NAME})`
			)

			SurfaceUSBElgatoStreamDeck.fromTcp(`tcp://${streamdeck.remoteAddress}:${streamdeck.remotePort}`, streamdeck)
				.then((panel) => {
					this.emit('connected', panel)
				})
				.catch((e) => {
					this.#logger.error(`Failed to add TCP Streamdeck: ${e}`)
					// TODO - how to handle?
					// streamdeck.close()
				})
		})
		// @ts-ignore why is this failing?
		this.#streamdeckManager.on('error', (error) => {
			this.#logger.error(`Error from TCP Streamdeck: ${error}`)
		})
	}

	connectTo(address: string, port: number): void {
		this.#streamdeckManager.connectTo(address, port)
	}

	disconnectFrom(address: string, port: number): boolean {
		return this.#streamdeckManager.disconnectFrom(address, port)
	}

	disconnectFromAll(): void {
		this.#streamdeckManager.disconnectFromAll()
	}

	updateConfig(config: SurfacePluginElgatoStreamDeckOutboundConfig): void {
		// const oldConfig = this.#config
		// this.#config = config
		// TODO - react to change
	}
}
