import type { ExecuteExpressionResult } from '../../Variables/Util.js'
import type { SurfacePanel } from '../Types.js'
import type { CompanionVariableValues } from '@companion-module/base'

export interface SurfacePluginBase<TConfig extends object | null> {
	// TODO

	readonly DefaultConfig: TConfig

	updateConfig(config: TConfig): void

	// getConfigFields(): Array<unknown>

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

export interface SurfacePluginProps {
	executeExpression: (
		str: string,
		surfaceId: string,
		injectedVariableValues: CompanionVariableValues | undefined
	) => ExecuteExpressionResult
}
