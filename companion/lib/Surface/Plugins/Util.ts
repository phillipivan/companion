import HID from 'node-hid'
import { SurfacePanel } from '../Types.js'

export function checkHidAccess(devicePath: string) {
	// Check if we have access to the device
	try {
		const devicetest = new HID.HID(devicePath)
		devicetest.close()
		return true
	} catch (e) {
		return false
	}
}

export class OpenSurfacesManager<TPanel extends SurfacePanel> {
	readonly #openSurfaces = new Map<string, TPanel | null>()

	hasSurface(id: string) {
		return this.#openSurfaces.has(id)
	}

	async tryOpening(id: string, fn: () => Promise<TPanel>): Promise<TPanel | null> {
		// Already open/opening
		if (this.#openSurfaces.has(id)) return null

		return this.#tryOpeningAfterDuplicateGuard(id, fn)
	}

	async tryOpeningWithHidAccessCheck(path: string, fn: () => Promise<TPanel>): Promise<TPanel | null> {
		// Already open/opening
		if (this.#openSurfaces.has(path)) return null

		// Check we have access to the device
		if (!checkHidAccess(path))
			throw new Error('No access to device. Please quit any other applications using the device, and try again.')

		return this.#tryOpeningAfterDuplicateGuard(path, fn)
	}

	async #tryOpeningAfterDuplicateGuard(id: string, fn: () => Promise<TPanel>): Promise<TPanel | null> {
		// Define something, so that it is known it is loading
		this.#openSurfaces.set(id, null)

		try {
			const dev = await fn()
			this.#openSurfaces.set(id, dev)
			return dev
		} catch (e) {
			// Failed, remove the placeholder
			this.#openSurfaces.delete(id)

			throw e
		}
	}
}

/**
 * Convert a number to rgb components
 */
export function colorToRgb(dec: number): RgbColor {
	const r = Math.round((dec & 0xff0000) >> 16)
	const g = Math.round((dec & 0x00ff00) >> 8)
	const b = Math.round(dec & 0x0000ff)

	return { r, g, b }
}
export interface RgbColor {
	r: number
	g: number
	b: number
}
