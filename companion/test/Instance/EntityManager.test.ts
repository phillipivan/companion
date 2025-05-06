import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InstanceEntityManager } from '../../lib/Instance/EntityManager.js'
import { EntityModelType } from '@companion-app/shared/Model/EntityModel.js'
import { nanoid } from 'nanoid'
import { ControlLocation } from '@companion-app/shared/Model/Common.js'

// Mock dependencies
vi.mock('nanoid', () => ({
	nanoid: vi.fn().mockReturnValue('mock-id'),
}))

describe('InstanceEntityManager', () => {
	// Create mock objects for dependencies
	const mockIpcWrapper = {
		sendWithCb: vi.fn().mockResolvedValue({
			updatedActions: [],
			updatedFeedbacks: [],
		}),
	}

	const mockControl = {
		entities: {
			entityReplace: vi.fn(),
		},
		supportsEntities: true,
		getBitmapSize: vi.fn().mockReturnValue({ width: 72, height: 58 }),
	}

	const mockControlsController = {
		getControl: vi.fn().mockReturnValue(mockControl),
	}

	const mockVariablesValues = {
		parseVariables: vi.fn().mockReturnValue({
			text: 'parsed-value',
			variableIds: ['var1', 'var2'],
		}),
	}

	const mockPagesController = {
		getLocationOfControlId: vi.fn(),
	}

	let entityManager: InstanceEntityManager

	// Reset mocks before each test
	beforeEach(() => {
		vi.clearAllMocks()
		// Create a new instance for each test
		entityManager = new InstanceEntityManager(
			mockIpcWrapper as any,
			mockControlsController as any,
			mockVariablesValues as any,
			mockPagesController as any
		)

		vi.useFakeTimers()
	})

	describe('constructor', () => {
		it('should create an instance with the correct properties', () => {
			expect(entityManager).toBeDefined()
		})
	})

	describe('start', () => {
		it('should set the ready flag and current upgrade index', () => {
			entityManager.start(5)

			// Wait for debounced function to execute
			vi.runAllTimers()

			// No entities yet, so no calls expected
			expect(mockIpcWrapper.sendWithCb).not.toHaveBeenCalled()
		})
	})

	describe('trackEntity', () => {
		it('should add an entity to the tracker', () => {
			const mockEntity = {
				id: 'entity-1',
				type: EntityModelType.Action,
				definitionId: 'action-1',
				asEntityModel: vi.fn().mockReturnValue({
					id: 'entity-1',
					type: EntityModelType.Action,
					definitionId: 'action-1',
					connectionId: 'connection-1',
					options: {},
				}),
				getEntityDefinition: vi.fn(),
			}

			entityManager.start(5)
			entityManager.trackEntity(mockEntity as any, 'control-1')

			// Verify the entity is being processed
			vi.runAllTimers()

			expect(mockIpcWrapper.sendWithCb).toHaveBeenCalledWith('updateActions', expect.anything())
		})

		it('should replace existing entity with the same ID', () => {
			const mockEntity1 = {
				id: 'entity-1',
				type: EntityModelType.Action,
				definitionId: 'action-1',
				asEntityModel: vi.fn().mockReturnValue({
					id: 'entity-1',
					type: EntityModelType.Action,
					definitionId: 'action-1',
					connectionId: 'connection-1',
					options: { original: true },
				}),
				getEntityDefinition: vi.fn(),
			}

			const mockEntity2 = {
				id: 'entity-1',
				type: EntityModelType.Action,
				definitionId: 'action-1',
				asEntityModel: vi.fn().mockReturnValue({
					id: 'entity-1',
					type: EntityModelType.Action,
					definitionId: 'action-1',
					connectionId: 'connection-1',
					options: { replaced: true },
				}),
				getEntityDefinition: vi.fn(),
			}

			entityManager.start(5)
			entityManager.trackEntity(mockEntity1 as any, 'control-1')

			// Clear calls from first entity
			vi.runAllTimers()
			mockIpcWrapper.sendWithCb.mockClear()

			// Track replacement entity
			entityManager.trackEntity(mockEntity2 as any, 'control-1')
			vi.runAllTimers()

			// Verify the replacement was processed
			expect(mockEntity2.asEntityModel).toHaveBeenCalled()
			expect(mockIpcWrapper.sendWithCb).toHaveBeenCalledWith(
				'updateActions',
				expect.objectContaining({
					actions: expect.anything(),
				})
			)
		})
	})

	describe('trackEntity for feedback', () => {
		it('should add a feedback entity and include image size', () => {
			const mockFeedback = {
				id: 'feedback-1',
				type: EntityModelType.Feedback,
				definitionId: 'feedback-def-1',
				asEntityModel: vi.fn().mockReturnValue({
					id: 'feedback-1',
					type: EntityModelType.Feedback,
					definitionId: 'feedback-def-1',
					connectionId: 'connection-1',
					options: {},
				}),
				getEntityDefinition: vi.fn(),
			}

			entityManager.start(5)
			entityManager.trackEntity(mockFeedback as any, 'control-1')

			// Verify the entity is being processed
			vi.runAllTimers()

			expect(mockControlsController.getControl).toHaveBeenCalledWith('control-1')
			expect(mockControl.getBitmapSize).toHaveBeenCalled()

			expect(mockIpcWrapper.sendWithCb).toHaveBeenCalledWith(
				'updateFeedbacks',
				expect.objectContaining({
					feedbacks: expect.objectContaining({
						'feedback-1': expect.objectContaining({
							image: { width: 72, height: 58 },
						}),
					}),
				})
			)
		})
	})

	describe('forgetEntity', () => {
		it('should mark entity for deletion', () => {
			const mockEntity = {
				id: 'entity-1',
				type: EntityModelType.Action,
				definitionId: 'action-1',
				asEntityModel: vi.fn().mockReturnValue({
					id: 'entity-1',
					type: EntityModelType.Action,
					definitionId: 'action-1',
					connectionId: 'connection-1',
					options: {},
				}),
				getEntityDefinition: vi.fn(),
			}

			entityManager.start(5)
			entityManager.trackEntity(mockEntity as any, 'control-1')
			entityManager.forgetEntity('entity-1')

			vi.runAllTimers()

			// Should have been called with null for the entity
			expect(mockIpcWrapper.sendWithCb).toHaveBeenCalledWith(
				'updateActions',
				expect.objectContaining({
					actions: expect.objectContaining({
						'entity-1': null,
					}),
				})
			)
		})

		it('should do nothing if entity does not exist', () => {
			entityManager.start(5)
			entityManager.forgetEntity('non-existent')

			vi.runAllTimers()

			expect(mockIpcWrapper.sendWithCb).not.toHaveBeenCalled()
		})
	})

	describe('resendFeedbacks', () => {
		it('should reset all feedback entities to unloaded state', () => {
			const mockFeedback = {
				id: 'feedback-1',
				type: EntityModelType.Feedback,
				definitionId: 'feedback-def-1',
				asEntityModel: vi.fn().mockReturnValue({
					id: 'feedback-1',
					type: EntityModelType.Feedback,
					definitionId: 'feedback-def-1',
					connectionId: 'connection-1',
					options: {},
				}),
				getEntityDefinition: vi.fn(),
			}

			entityManager.start(5)
			entityManager.trackEntity(mockFeedback as any, 'control-1')

			// First clear the initial processing
			vi.runAllTimers()
			mockIpcWrapper.sendWithCb.mockClear()

			// Now resend feedbacks
			entityManager.resendFeedbacks()
			vi.runAllTimers()

			expect(mockIpcWrapper.sendWithCb).toHaveBeenCalledWith('updateFeedbacks', expect.anything())
		})

		it('should handle entities in various states correctly when resending', () => {
			// Create multiple feedback entities
			const createMockFeedback = (id: string) => ({
				id,
				type: EntityModelType.Feedback,
				definitionId: 'feedback-def-1',
				asEntityModel: vi.fn().mockReturnValue({
					id,
					type: EntityModelType.Feedback,
					definitionId: 'feedback-def-1',
					connectionId: 'connection-1',
					options: {},
				}),
				getEntityDefinition: vi.fn(),
			})

			const mockFeedbacks = [
				createMockFeedback('feedback-1'),
				createMockFeedback('feedback-2'),
				createMockFeedback('feedback-3'),
			]

			entityManager.start(5)

			// Add all feedbacks
			mockFeedbacks.forEach((fb, i) => {
				entityManager.trackEntity(fb as any, `control-${i + 1}`)
			})

			// Process initial state
			vi.runAllTimers()
			mockIpcWrapper.sendWithCb.mockClear()

			// Force feedback-2 to be forgotten
			entityManager.forgetEntity('feedback-2')

			// Now resend feedbacks
			entityManager.resendFeedbacks()
			vi.runAllTimers()

			// Should have been called with the appropriate feedbacks
			expect(mockIpcWrapper.sendWithCb).toHaveBeenCalledWith(
				'updateFeedbacks',
				expect.objectContaining({
					feedbacks: expect.objectContaining({
						'feedback-1': expect.anything(), // resent
						'feedback-3': expect.anything(), // resent
					}),
				})
			)
		})
	})

	describe('parseOptionsObject', () => {
		it('should return unchanged options if no entityDefinition provided', () => {
			const options = { key1: 'value1' }
			const result = entityManager.parseOptionsObject(undefined, options, undefined)

			expect(result).toEqual({
				parsedOptions: options,
				referencedVariableIds: expect.any(Set),
			})
			expect(result.referencedVariableIds.size).toBe(0)
		})

		it('should parse options with variables', () => {
			const entityDefinition = {
				options: [
					{ id: 'field1', type: 'textinput', useVariables: true },
					{ id: 'field2', type: 'dropdown' },
				],
			}
			const options = { field1: '$(var:text)', field2: 'option1' }
			const location: ControlLocation = {
				pageNumber: 1,
				column: 2,
				row: 3,
			}

			const result = entityManager.parseOptionsObject(entityDefinition as any, options, location)

			expect(mockVariablesValues.parseVariables).toHaveBeenCalledWith('$(var:text)', location)
			expect(result.parsedOptions).toEqual({
				field1: 'parsed-value',
				field2: 'option1',
			})
			expect(result.referencedVariableIds.has('var1')).toBe(true)
			expect(result.referencedVariableIds.has('var2')).toBe(true)
		})

		it('should pass through non-variable fields unchanged', () => {
			const entityDefinition = {
				options: [{ id: 'field1', type: 'number' }],
			}
			const options = { field1: 42 }

			const result = entityManager.parseOptionsObject(entityDefinition as any, options, undefined)

			expect(result.parsedOptions).toEqual({ field1: 42 })
			expect(mockVariablesValues.parseVariables).not.toHaveBeenCalled()
		})

		it('should handle missing option values', () => {
			const entityDefinition = {
				options: [
					{ id: 'field1', type: 'textinput', useVariables: true },
					{ id: 'field2', type: 'dropdown' },
				],
			}
			const options = { field2: 'option1' } // field1 missing

			// For missing fields, parseVariables will be called with "undefined"
			// So we need to update our mock for this specific test case
			mockVariablesValues.parseVariables.mockReturnValueOnce({
				text: undefined,
				variableIds: [],
			})

			const result = entityManager.parseOptionsObject(entityDefinition as any, options, undefined)

			// field1 should be undefined in the parsed options
			expect(result.parsedOptions).toEqual({
				field1: undefined,
				field2: 'option1',
			})

			// parseVariables should be called with "undefined" for the missing field
			expect(mockVariablesValues.parseVariables).toHaveBeenCalledWith('undefined', undefined)
		})
	})

	describe('onVariablesChanged', () => {
		it('should invalidate entities that reference changed variables', () => {
			// Setup an entity that references variables
			const mockEntity = {
				id: 'entity-1',
				type: EntityModelType.Action,
				definitionId: 'action-1',
				upgradeIndex: 5,
				asEntityModel: vi.fn().mockReturnValue({
					id: 'entity-1',
					type: EntityModelType.Action,
					definitionId: 'action-1',
					connectionId: 'connection-1',
					options: { field1: '$(var:test)' },
				}),
				getEntityDefinition: vi.fn().mockReturnValue({
					options: [{ id: 'field1', type: 'textinput', useVariables: true }],
				}),
			}

			// Set location for parsing
			mockPagesController.getLocationOfControlId.mockReturnValue({ pageNumber: 1, column: 2, row: 3 })

			// Add entity to manager
			entityManager.start(5)
			entityManager.trackEntity(mockEntity as any, 'control-1')

			// Process the entity so it references variables
			vi.runAllTimers()
			mockIpcWrapper.sendWithCb.mockClear()

			// Simulate variables changing
			entityManager.onVariablesChanged(new Set(['var1']))
			vi.runAllTimers()

			// Verify it triggered a re-process
			expect(mockIpcWrapper.sendWithCb).toHaveBeenCalledWith('updateActions', expect.anything())
		})

		it('should not invalidate entities if changed variables are not referenced', () => {
			// Setup an entity that references variables
			const mockEntity = {
				id: 'entity-1',
				type: EntityModelType.Action,
				definitionId: 'action-1',
				upgradeIndex: 5,
				asEntityModel: vi.fn().mockReturnValue({
					id: 'entity-1',
					type: EntityModelType.Action,
					definitionId: 'action-1',
					connectionId: 'connection-1',
					options: { field1: '$(var:test)' },
				}),
				getEntityDefinition: vi.fn().mockReturnValue({
					options: [{ id: 'field1', type: 'textinput', useVariables: true }],
				}),
			}

			// Set location for parsing
			mockPagesController.getLocationOfControlId.mockReturnValue({ pageNumber: 1, column: 2, row: 3 })

			// Customize parse variables to return specific variables
			mockVariablesValues.parseVariables.mockReturnValue({
				text: 'parsed-value',
				variableIds: ['specific-var'],
			})

			// Add entity to manager
			entityManager.start(5)
			entityManager.trackEntity(mockEntity as any, 'control-1')

			// Process the entity so it references variables
			vi.runAllTimers()
			mockIpcWrapper.sendWithCb.mockClear()

			// Simulate unrelated variables changing
			entityManager.onVariablesChanged(new Set(['unrelated-var']))
			vi.runAllTimers()

			// Should not have triggered a re-process
			expect(mockIpcWrapper.sendWithCb).not.toHaveBeenCalled()
		})
	})

	describe('Entity upgrade process', () => {
		it('should send entity for upgrade when upgradeIndex is different', () => {
			// Create entity with older upgrade index
			const mockEntity = {
				id: 'entity-1',
				type: EntityModelType.Action,
				definitionId: 'action-1',
				upgradeIndex: 3, // Lower than the current index (5)
				asEntityModel: vi.fn().mockReturnValue({
					id: 'entity-1',
					type: EntityModelType.Action,
					definitionId: 'action-1',
					connectionId: 'connection-1',
					options: {},
					upgradeIndex: 3,
				}),
				getEntityDefinition: vi.fn(),
			}

			entityManager.start(5)
			entityManager.trackEntity(mockEntity as any, 'control-1')

			vi.runAllTimers()

			// Should have called upgradeActionsAndFeedbacks
			expect(mockIpcWrapper.sendWithCb).toHaveBeenCalledWith(
				'upgradeActionsAndFeedbacks',
				expect.objectContaining({
					actions: expect.arrayContaining([
						expect.objectContaining({
							id: 'entity-1',
							upgradeIndex: 3,
						}),
					]),
					feedbacks: [],
				})
			)
		})

		it('should update entity with upgraded version when upgrade completes', async () => {
			// Create entity with older upgrade index
			const mockEntity = {
				id: 'entity-1',
				type: EntityModelType.Action,
				definitionId: 'action-1',
				upgradeIndex: 3,
				asEntityModel: vi.fn().mockReturnValue({
					id: 'entity-1',
					type: EntityModelType.Action,
					definitionId: 'action-1',
					connectionId: 'connection-1',
					options: { old: true },
					upgradeIndex: 3,
				}),
				getEntityDefinition: vi.fn(),
			}

			// Mock the control
			const mockControl = {
				entities: {
					entityReplace: vi.fn(),
				},
				supportsEntities: true,
			}
			mockControlsController.getControl.mockReturnValue(mockControl)

			// Setup the upgrade response
			mockIpcWrapper.sendWithCb.mockImplementationOnce(async () => {
				return {
					updatedActions: [
						{
							id: 'entity-1',
							actionId: 'action-1',
							options: { upgraded: true },
							upgradeIndex: 5,
						},
					],
					updatedFeedbacks: [],
				}
			})

			entityManager.start(5)
			entityManager.trackEntity(mockEntity as any, 'control-1')

			// Run timers to trigger the initial process
			vi.runAllTimers()

			// Wait for the Promise microtasks to resolve
			await vi.runAllTimersAsync()

			// Verify that the entityReplace was called with the upgraded entity
			expect(mockControl.entities.entityReplace).toHaveBeenCalledWith(
				expect.objectContaining({
					id: 'entity-1',
					type: EntityModelType.Action,
					definitionId: 'action-1',
					options: { upgraded: true },
					upgradeIndex: 5,
				})
			)
		})
	})

	describe('destroy', () => {
		it('should clear entities and set ready to false', () => {
			const mockEntity = {
				id: 'entity-1',
				type: EntityModelType.Action,
				definitionId: 'action-1',
				asEntityModel: vi.fn(),
				getEntityDefinition: vi.fn(),
			}

			entityManager.start(5)
			entityManager.trackEntity(mockEntity as any, 'control-1')

			entityManager.destroy()

			// After destroy, tracking a new entity should not call processing
			mockIpcWrapper.sendWithCb.mockClear()
			entityManager.trackEntity(mockEntity as any, 'control-1')
			vi.runAllTimers()

			expect(mockIpcWrapper.sendWithCb).not.toHaveBeenCalled()
		})
	})
})
