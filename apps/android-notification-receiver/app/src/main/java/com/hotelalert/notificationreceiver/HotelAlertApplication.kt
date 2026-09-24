package com.hotelalert.notificationreceiver

import android.app.Application
import com.hotelalert.notificationreceiver.network.HttpDeviceSnapshotClient
import com.hotelalert.notificationreceiver.network.HttpDeviceRequestCommandClient
import com.hotelalert.notificationreceiver.network.HttpRoomPresenceClient
import com.hotelalert.notificationreceiver.network.SocketIoRealtimeSocketFactory
import com.hotelalert.notificationreceiver.notification.AndroidNotificationSink
import com.hotelalert.notificationreceiver.protocol.NativePairingCoordinator
import com.hotelalert.notificationreceiver.protocol.NativeRoomSessionCoordinator
import com.hotelalert.notificationreceiver.protocol.RoomPresenceCoordinator
import com.hotelalert.notificationreceiver.protocol.RoomPresenceState
import com.hotelalert.notificationreceiver.protocol.RoomPresenceStatusStore
import com.hotelalert.notificationreceiver.protocol.NativeRequestCommandCoordinator
import com.hotelalert.notificationreceiver.protocol.NativeRequestCommandResult
import com.hotelalert.notificationreceiver.protocol.NativeRequestTransition
import com.hotelalert.notificationreceiver.protocol.ReceiverConfigurationStore
import com.hotelalert.notificationreceiver.protocol.ReceiverStartupCoordinator
import com.hotelalert.notificationreceiver.receiver.AndroidLanReceiver
import com.hotelalert.notificationreceiver.receiver.AndroidReceiverServiceController
import com.hotelalert.notificationreceiver.receiver.AndroidRoomPresenceServiceController
import com.hotelalert.notificationreceiver.receiver.NativeReceiverSnapshotStore
import com.hotelalert.notificationreceiver.receiver.ReceiverStatusStore
import com.hotelalert.notificationreceiver.storage.AndroidKeyStoreDeviceTokenStore
import com.hotelalert.notificationreceiver.storage.AndroidPairingStateStore
import com.hotelalert.notificationreceiver.storage.AndroidReceiverConfigurationStore
import com.hotelalert.notificationreceiver.storage.AndroidRoomPresenceSessionStore
import com.hotelalert.notificationreceiver.storage.AndroidServerOriginStore
import com.hotelalert.notificationreceiver.storage.AtomicFileAreaSnapshotPersistence
import com.hotelalert.notificationreceiver.storage.AtomicFileCursorStore
import com.hotelalert.notificationreceiver.storage.DeviceTokenStore
import com.hotelalert.notificationreceiver.web.ServerOriginStore
import com.hotelalert.notificationreceiver.web.ValidatedServerOriginStore
import com.hotelalert.notificationreceiver.web.HotelAlertWebBridge
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import java.util.UUID

class HotelAlertApplication : Application() {
    lateinit var component: AndroidReceiverComponent
        private set

    override fun onCreate() {
        super.onCreate()
        component = AndroidReceiverComponent(this)
    }
}

class AndroidReceiverComponent(context: Application) {
    val statusStore = ReceiverStatusStore()
    private val roomPresenceSessionStore = AndroidRoomPresenceSessionStore(context)
    val roomPresenceStatusStore = RoomPresenceStatusStore(
        if (roomPresenceSessionStore.wasInvalidated()) RoomPresenceState.INVALIDATED else RoomPresenceState.IDLE
    )
    val configurationStore: ReceiverConfigurationStore = AndroidReceiverConfigurationStore(context)
    val tokenStore: DeviceTokenStore = AndroidKeyStoreDeviceTokenStore(context)
    val snapshotStore = NativeReceiverSnapshotStore(
        configurationStore = configurationStore,
        persistence = AtomicFileAreaSnapshotPersistence(context)
    )
    private val startupCoordinator = ReceiverStartupCoordinator(configurationStore, tokenStore)
    val serverOriginStore: ServerOriginStore = ValidatedServerOriginStore(AndroidServerOriginStore(context))
    private val cursorStore = AtomicFileCursorStore(context)
    private val snapshotClient = HttpDeviceSnapshotClient()
    private val requestCommandClient = HttpDeviceRequestCommandClient()
    private val socketFactory = SocketIoRealtimeSocketFactory()
    private val notificationSink = AndroidNotificationSink(context)
    private val pairingStateStore = AndroidPairingStateStore(configurationStore, tokenStore)
    private val serviceController = AndroidReceiverServiceController(context)
    private val roomPresenceServiceController = AndroidRoomPresenceServiceController(context)
    private val roomPresenceClient = HttpRoomPresenceClient()
    private val bridgeScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val pairingCoordinator = NativePairingCoordinator(
        serverOriginStore = serverOriginStore,
        snapshotClient = snapshotClient,
        stateStore = pairingStateStore,
        serviceController = serviceController,
        clientInstanceIdFactory = { UUID.randomUUID().toString() },
        clientVersion = BuildConfig.VERSION_NAME,
        onSnapshot = snapshotStore::update
    )
    private val requestCommandCoordinator = NativeRequestCommandCoordinator(
        configurationStore = configurationStore,
        tokenStore = tokenStore,
        snapshotStore = snapshotStore,
        client = requestCommandClient
    )
    private val roomSessionCoordinator = NativeRoomSessionCoordinator(
        serverOriginStore = serverOriginStore,
        sessionStore = roomPresenceSessionStore,
        serviceController = roomPresenceServiceController,
        statusStore = roomPresenceStatusStore,
        clientVersion = BuildConfig.VERSION_NAME
    )
    val webBridge: HotelAlertWebBridge by lazy {
        HotelAlertWebBridge(
            bridgeScope,
            pairingCoordinator,
            snapshotStore,
            statusStore,
            requestCommandCoordinator,
            roomSessionCoordinator,
            roomPresenceStatusStore
        )
    }

    suspend fun transitionRequest(request: NativeRequestTransition): NativeRequestCommandResult =
        requestCommandCoordinator.transition(request)

    suspend fun shouldStartReceiver(): Boolean = startupCoordinator.shouldStartReceiver()

    fun createRoomPresenceCoordinator(): RoomPresenceCoordinator = RoomPresenceCoordinator(
        sessionStore = roomPresenceSessionStore,
        client = roomPresenceClient,
        statusStore = roomPresenceStatusStore
    )

    fun createReceiver(scope: CoroutineScope): AndroidLanReceiver = AndroidLanReceiver(
        configurationStore = configurationStore,
        tokenStore = tokenStore,
        cursorStore = cursorStore,
        snapshotClient = snapshotClient,
        socketFactory = socketFactory,
        sink = notificationSink,
        scope = scope,
        onStateChanged = statusStore::update,
        onAuthFailure = { statusStore.update(com.hotelalert.notificationreceiver.protocol.ReceiverState.AUTH_FAILED) },
        onDeviceInvalidated = { clearInvalidatedDeviceState() },
        onError = { statusStore.update(com.hotelalert.notificationreceiver.protocol.ReceiverState.ERROR) },
        onSnapshotChanged = snapshotStore::update
    )

    private suspend fun clearInvalidatedDeviceState() {
        snapshotStore.update(null)
        runCatching { tokenStore.clear() }
        runCatching { configurationStore.clearDeviceAssignment() }
        runCatching { cursorStore.clear() }
    }
}
