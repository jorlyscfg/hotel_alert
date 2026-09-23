package com.hotelalert.notificationreceiver.receiver

class NativeReceiverSnapshotStore {
    @Volatile
    private var snapshotJson: String? = null

    fun update(snapshot: String?) {
        snapshotJson = snapshot
    }

    fun read(): String? = snapshotJson
}
