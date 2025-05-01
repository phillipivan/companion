import debounceFn from 'debounce-fn'
import type { ControlEntityInstance } from '../Controls/Entities/EntityInstance.js'
import type {
	HostToModuleEventsV0,
	ModuleToHostEventsV0,
	UpdateActionInstancesMessage,
	UpdateFeedbackInstancesMessage,
	UpgradeActionAndFeedbackInstancesMessage,
} from '@companion-module/base/dist/host-api/api.js'
import { assertNever } from '@companion-app/shared/Util.js'
import { EntityModelType } from '@companion-app/shared/Model/EntityModel.js'
import type { IpcWrapper } from '@companion-module/base/dist/host-api/ipc-wrapper.js'
import { nanoid } from 'nanoid'

enum EntityState {
	UNLOADED = 'UNLOADED',
	UPGRADING = 'UPGRADING',
	UPGRADING_INVALIDATED = 'UPGRADING_INVALIDATED',
	READY = 'READY',
	PENDING_DELETE = 'PENDING_DELETE',
}

interface EntityWrapper {
	/** A unqiue id for this wrapper, so that we know if the entity was replaced/deleted */
	readonly wrapperId: string
	readonly entity: ControlEntityInstance // TODO - should this be a weak ref?
	readonly controlId: string

	state: EntityState
}

export class InstanceEntityManager {
	readonly #entities = new Map<string, EntityWrapper>()
	readonly #ipcWrapper: IpcWrapper<HostToModuleEventsV0, ModuleToHostEventsV0>

	// Before the connection is ready, we need to not send any updates
	#ready = false
	#currentUpgradeIndex = 0

	constructor(ipcWrapper: IpcWrapper<HostToModuleEventsV0, ModuleToHostEventsV0>) {
		this.#ipcWrapper = ipcWrapper
	}

	readonly #debounceProcessPending = debounceFn(
		() => {
			if (!this.#ready) return

			// TODO - each entity needs to trcak its upgradeIndex now, otherwise we stand no chance of tracking it correctly.
			// Or perhaps more importantly, if it doesn't, then how do we know at this point whether to run it through them

			const entityIdsInThisBatch = new Map<string, string>()
			const upgradePayload: UpgradeActionAndFeedbackInstancesMessage = {
				actions: [],
				feedbacks: [],
				defaultUpgradeIndex: 0, // TODO - remove this!
			}
			const updateActionsPayload: UpdateActionInstancesMessage = {
				actions: {},
			}
			const updateFeedbacksPayload: UpdateFeedbackInstancesMessage = {
				feedbacks: {},
			}

			const pushEntityToUpgrade = (wrapper: EntityWrapper) => {
				entityIdsInThisBatch.set(wrapper.entity.id, wrapper.wrapperId)
				const entityModel = wrapper.entity.asEntityModel(false)
				switch (entityModel.type) {
					case EntityModelType.Action:
						upgradePayload.actions.push({
							id: entityModel.id,
							controlId: wrapper.controlId,
							actionId: entityModel.definitionId,
							options: entityModel.options,

							upgradeIndex: entityModel.upgradeIndex ?? null,
							disabled: !!entityModel.disabled,
						})
						break
					case EntityModelType.Feedback:
						upgradePayload.feedbacks.push({
							id: entityModel.id,
							controlId: wrapper.controlId,
							feedbackId: entityModel.definitionId,
							options: entityModel.options,

							isInverted: !!entityModel.isInverted,

							upgradeIndex: entityModel.upgradeIndex ?? null,
							disabled: !!entityModel.disabled,
						})
						break
					default:
						assertNever(entityModel)
						console.log('Unknown entity type', wrapper.entity.type)
				}
			}

			// First, look over all the entiites and figure out what needs to be done to each
			for (const [entityId, wrapper] of this.#entities) {
				switch (wrapper.state) {
					case EntityState.UNLOADED:
						// The entity is unloaded, it either needs to be upgraded or loaded
						if (wrapper.entity.upgradeIndex === this.#currentUpgradeIndex) {
							wrapper.state = EntityState.READY

							const entityModel = wrapper.entity.asEntityModel(false)
							switch (entityModel.type) {
								case EntityModelType.Action:
									updateActionsPayload.actions[entityId] = {
										id: entityModel.id,
										controlId: wrapper.controlId,
										actionId: entityModel.definitionId,
										options: entityModel.options,

										upgradeIndex: entityModel.upgradeIndex ?? null,
										disabled: !!entityModel.disabled,
									}
									break
								case EntityModelType.Feedback:
									updateFeedbacksPayload.feedbacks[entityId] = {
										id: entityModel.id,
										controlId: wrapper.controlId,
										feedbackId: entityModel.definitionId,
										options: entityModel.options,

										image: undefined, // TODO

										isInverted: !!entityModel.isInverted,

										upgradeIndex: entityModel.upgradeIndex ?? null,
										disabled: !!entityModel.disabled,
									}
									break
								default:
									assertNever(entityModel)
									console.log('Unknown entity type', wrapper.entity.type)
							}
						} else {
							wrapper.state = EntityState.UPGRADING
							pushEntityToUpgrade(wrapper)
						}
						break
					case EntityState.UPGRADING:
					case EntityState.UPGRADING_INVALIDATED:
						// In progress, ignore
						break
					case EntityState.READY:
						// Already processed, ignore
						break
					case EntityState.PENDING_DELETE:
						// Plan for deletion
						this.#entities.delete(entityId)

						switch (wrapper.entity.type) {
							case EntityModelType.Action:
								updateActionsPayload.actions[entityId] = null
								break
							case EntityModelType.Feedback:
								updateFeedbacksPayload.feedbacks[entityId] = null
								break
							default:
								assertNever(wrapper.entity.type)
								console.log('Unknown entity type', wrapper.entity.type)
						}
						break

					default:
						assertNever(wrapper.state)
				}
			}

			// Start by sending the simple payloads
			if (Object.keys(updateActionsPayload.actions).length > 0) {
				this.#ipcWrapper.sendWithCb('updateActions', updateActionsPayload).catch((e) => {
					console.error('Error sending updateActions', e)
				})
			}
			if (Object.keys(updateFeedbacksPayload.feedbacks).length > 0) {
				this.#ipcWrapper.sendWithCb('updateFeedbacks', updateFeedbacksPayload).catch((e) => {
					console.error('Error sending updateFeedbacks', e)
				})
			}

			// Now we need to send the upgrades
			if (upgradePayload.actions.length > 0 || upgradePayload.feedbacks.length > 0) {
				this.#ipcWrapper
					.sendWithCb('upgradeActionsAndFeedbacks', upgradePayload)
					.then((upgraded) => {
						if (!this.#ready) return

						// We have the upgraded entities, lets patch the tracked entities

						const upgradedActions = new Map(upgraded.updatedActions.map((act) => [act.id, act]))
						const upgradedFeedbacks = new Map(upgraded.updatedFeedbacks.map((fb) => [fb.id, fb]))

						// Loop through what we sent, as we don't get a response for all of them
						for (const [entityId, wrapperId] of entityIdsInThisBatch) {
							const wrapper = this.#entities.get(entityId)
							// Entity may have been deleted or recreated, if so we can ignore it
							if (!wrapper || wrapper.wrapperId !== wrapperId) continue

							switch (wrapper.state) {
								case EntityState.UPGRADING_INVALIDATED:
									// It has been invalidated, it needs to be re-run
									wrapper.state = EntityState.UNLOADED
									break
								case EntityState.UPGRADING:
									// It has been upgraded, so we can update the entity
									// TODO

									switch (wrapper.entity.type) {
										case EntityModelType.Action: {
											const action = upgradedActions.get(wrapper.entity.id)
											if (action) {
												wrapper.entity.replaceProps({
													id: action.id,
													type: EntityModelType.Action,
													definitionId: action.actionId,
													options: action.options,
													upgradeIndex: action.upgradeIndex ?? this.#currentUpgradeIndex,
												})
											}
											break
										}
										case EntityModelType.Feedback: {
											const feedback = upgradedFeedbacks.get(wrapper.entity.id)
											if (feedback) {
												wrapper.entity.replaceProps({
													id: feedback.id,
													type: EntityModelType.Feedback,
													definitionId: feedback.feedbackId,
													options: feedback.options,
													style: feedback.style,
													isInverted: feedback.isInverted,
													upgradeIndex: feedback.upgradeIndex ?? this.#currentUpgradeIndex,
												})
											}
											break
										}
										default:
											assertNever(wrapper.entity.type)
											break
									}

									break
								case EntityState.READY:
								case EntityState.UNLOADED:
									// Shouldn't happen, lets pretend it didnt
									break
								case EntityState.PENDING_DELETE:
									// About to be deleted, so we can ignore it
									break

								default:
									assertNever(wrapper.state)
									break
							}
						}

						this.#debounceProcessPending()
					})
					.catch((e) => {
						console.error('Error sending upgradeActionsAndFeedbacks', e)

						// There isn't much we can do to retry the upgrad, the best we can do is pretend it was fine and progress the entities through the process
						for (const [entityId, wrapperId] of entityIdsInThisBatch) {
							const wrapper = this.#entities.get(entityId)
							if (!wrapper || wrapper.wrapperId !== wrapperId) continue
							if (wrapper.state === EntityState.UPGRADING) {
								// Pretend it was fine
								wrapper.state = EntityState.READY
							} else if (wrapper.state === EntityState.UPGRADING_INVALIDATED) {
								// This can be retried
								wrapper.state = EntityState.UNLOADED
							}
						}

						// Make sure anything pending is processed
						this.#debounceProcessPending()
					})
			}
		},
		{
			before: false,
			after: true,
			maxWait: 50,
			wait: 10,
		}
	)

	start(currentUpgradeIndex: number): void {
		this.#ready = true
		this.#currentUpgradeIndex = currentUpgradeIndex

		this.#debounceProcessPending()
	}

	destroy() {
		this.#debounceProcessPending.cancel()
		this.#entities.clear()
		this.#ready = false
	}

	trackEntity(entity: ControlEntityInstance, controlId: string): void {
		// This may replace an existing entity, if so it needs to follow the usual process
		this.#entities.set(entity.id, {
			wrapperId: nanoid(),
			entity,
			controlId: controlId,
			state: EntityState.UNLOADED,
		})

		this.#debounceProcessPending()
	}

	forgetEntity(entityId: string): void {
		const wrapper = this.#entities.get(entityId)
		if (!wrapper) return

		// mark as pending deletion
		wrapper.state = EntityState.PENDING_DELETE

		this.#debounceProcessPending()
	}
}
