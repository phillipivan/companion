import { ConnectionGroup } from '@companion-app/shared/Model/Connections.js'
import { observer } from 'mobx-react-lite'
import React, { useCallback } from 'react'
import { useConnectionListDragging } from './ConnectionListDropZone.js'
import { ConnectionListApi } from './ConnectionListApi.js'
import { CollapsibleGroupRow } from '../../Components/CollapsibleGroupRow.js'
import { CFormSwitch } from '@coreui/react'
import classNames from 'classnames'

interface ConnectionGroupRowProps {
	group: ConnectionGroup
	toggleExpanded: (groupId: string) => void
	connectionListApi: ConnectionListApi
	isCollapsed: boolean
	index: number
	enabledStatus: boolean | null | undefined
}

export const ConnectionGroupRow = observer(function ConnectionGroupRow({
	group,
	toggleExpanded,
	connectionListApi,
	isCollapsed,
	index,
	enabledStatus,
}: ConnectionGroupRowProps) {
	const toggleEnabled = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			e.preventDefault()
			e.stopPropagation()
			connectionListApi.setGroupEnabled(group.id, e.target.checked)
		},
		[group.id, connectionListApi.setGroupEnabled]
	)

	const { drop: dropInto } = useConnectionListDragging(group.id, -1)

	return (
		<CollapsibleGroupRow<ConnectionGroup>
			group={group}
			isCollapsed={isCollapsed}
			toggleExpanded={toggleExpanded}
			index={index}
			acceptDragType="connection-group"
			groupApi={connectionListApi}
			dropInto={dropInto}
		>
			<CFormSwitch
				className={classNames('connection-enabled-switch', {
					indeterminate: enabledStatus === null,
				})}
				color="success"
				disabled={enabledStatus === undefined}
				checked={!!enabledStatus}
				onChange={toggleEnabled}
				size="xl"
				title={!!enabledStatus ? 'Disable all connections in group' : 'Enable all connections in group'}
			/>
		</CollapsibleGroupRow>
	)
})
