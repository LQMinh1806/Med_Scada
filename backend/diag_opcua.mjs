// Diagnostic script — kiểm tra kết nối OPC UA và subscription
import opcua from 'node-opcua';
const {
  OPCUAClient,
  MessageSecurityMode,
  SecurityPolicy,
  AttributeIds,
  ClientSubscription,
  ClientMonitoredItem,
  TimestampsToReturn,
} = opcua;

const ENDPOINT = 'opc.tcp://127.0.0.1:49320';
const TAG_PREFIX = 'ns=2;s=PLC1.Cabin.';

const READ_TAGS = {
  currentStation: `${TAG_PREFIX}Current_Station`,
  robotStatus:    `${TAG_PREFIX}Robot_Status`,
  cabinReady:     `${TAG_PREFIX}Cabin_Ready`,
  eStopStatus:    `${TAG_PREFIX}E-Stop_CMD`,
};

const client = OPCUAClient.create({
  applicationName: 'SCADA-Diag',
  securityMode: MessageSecurityMode.None,
  securityPolicy: SecurityPolicy.None,
  endpointMustExist: false,
  requestedSessionTimeout: 60000,
});

try {
  await client.connect(ENDPOINT);
  console.log('✅ TCP connected to Kepware');

  const session = await client.createSession();
  console.log('✅ OPC UA session created\n');

  // 1. Direct read test
  console.log('=== DIRECT READ TEST ===');
  for (const [key, nodeId] of Object.entries(READ_TAGS)) {
    const dv = await session.read({ nodeId, attributeId: AttributeIds.Value });
    const ok = dv.statusCode?.name === 'Good';
    console.log(`${ok ? '✅' : '❌'} ${key.padEnd(18)}: value=${String(dv.value?.value).padEnd(8)} status=${dv.statusCode?.name}`);
  }

  // 2. Subscription test
  console.log('\n=== SUBSCRIPTION TEST (6 seconds) ===');
  const sub = ClientSubscription.create(session, {
    requestedPublishingInterval: 500,
    requestedLifetimeCount: 120,
    requestedMaxKeepAliveCount: 20,
    maxNotificationsPerPublish: 50,
    publishingEnabled: true,
    priority: 10,
  });

  await new Promise((resolve) => {
    sub.on('started', () => {
      console.log(`✅ Subscription started, ID=${sub.subscriptionId}`);
      resolve();
    });
    sub.on('error', (err) => {
      console.error('❌ Subscription error:', err.message);
      resolve();
    });
    setTimeout(resolve, 3000); // fallback timeout
  });

  let changeCount = 0;
  for (const [key, nodeId] of Object.entries(READ_TAGS)) {
    const item = ClientMonitoredItem.create(
      sub,
      { nodeId, attributeId: AttributeIds.Value },
      { samplingInterval: 500, discardOldest: true, queueSize: 1 },
      TimestampsToReturn.Both,
    );
    item.on('changed', (dv) => {
      changeCount++;
      const ok = dv.statusCode?.value === 0;
      console.log(`📡 CHANGED ${key.padEnd(18)}: value=${String(dv.value?.value).padEnd(8)} statusCode=${dv.statusCode?.value} (${dv.statusCode?.name ?? 'unknown'}) ${ok ? '✅' : '⚠️ BAD QUALITY'}`);
    });
    item.on('err', (err) => console.error(`❌ Monitor error on ${key}:`, err));
    console.log(`   Monitoring: ${key} → ${nodeId}`);
  }

  await new Promise(r => setTimeout(r, 6000));

  console.log(`\n=== RESULT ===`);
  if (changeCount === 0) {
    console.log('⚠️  KHÔNG nhận được bất kỳ notification nào trong 6 giây!');
    console.log('   → Kiểm tra: subscription.publishingEnabled? Tags thực sự thay đổi?');
  } else {
    console.log(`✅ Nhận được ${changeCount} notification(s) từ Kepware`);
  }

  await sub.terminate();
  await session.close();
  await client.disconnect();
  console.log('✅ Disconnected cleanly');
} catch (err) {
  console.error('❌ FATAL ERROR:', err.message);
  console.error(err.stack);
  process.exit(1);
}
