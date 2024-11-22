import HID from 'node-hid'

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
