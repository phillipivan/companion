import type { ExecuteExpressionResult } from '../../Variables/Util.js'
import type { SurfacePanel } from '../Types.js'
import type { CompanionVariableValues } from '@companion-module/base'
import type { EventEmitter } from 'events'

export interface SurfacePluginBase2<TConfig extends object | null> {
	readonly DefaultConfig: TConfig

	updateConfig(config: TConfig): void

	// getConfigFields(): Array<unknown>
}

export interface SurfacePluginBase<TConfig extends object | null> extends SurfacePluginBase2<TConfig> {
	/**
	 * Scan for new devices
	 */
	refreshSurfaces(): Promise<SurfacePanel[]>

	// /**
	//  * Devices have been detected via hotplug, attempt to open any that are not already open
	//  * @param devices
	//  */
	// detectedSurfaces(devices: Array<unknown>): Promise<SurfacePanel[]>
}

export interface SurfaceOutboundPluginEvents {
	connected: [panel: SurfacePanel]
}

export interface SurfaceOutboundPluginBase<TConfig extends object | null>
	extends SurfacePluginBase2<TConfig>,
		EventEmitter<SurfaceOutboundPluginEvents> {
	/**
	 * Scan for new devices
	 */
	connectTo(address: string, port: number): void

	disconnectFrom(address: string, port: number): boolean

	disconnectFromAll(): void
}

export interface SurfacePluginProps {
	executeExpression: (
		str: string,
		surfaceId: string,
		injectedVariableValues: CompanionVariableValues | undefined
	) => ExecuteExpressionResult
}
