import opcua from 'node-opcua';

const { OPCUAClient, MessageSecurityMode, SecurityPolicy, AttributeIds } = opcua;
const endpointUrl = 'opc.tcp://127.0.0.1:49320';

async function test() {
  const client = OPCUAClient.create({
    endpointMustExist: false,
    securityMode: MessageSecurityMode.None,
    securityPolicy: SecurityPolicy.None,
  });

  try {
    await client.connect(endpointUrl);
    const session = await client.createSession();
    
    for (let i = 0; i < 5; i++) {
      const dataValue = await session.read({
        nodeId: 'ns=2;s=PLC1.Cabin._System._Error',
        attributeId: AttributeIds.Value
      });
      console.log(`[${i}] _Error:`, dataValue.value?.value, dataValue.statusCode.name);
      
      const stValue = await session.read({
        nodeId: 'ns=2;s=PLC1.Cabin.Target_Station',
        attributeId: AttributeIds.Value
      });
      console.log(`[${i}] Target_Station:`, stValue.value?.value, stValue.statusCode.name);
      
      await new Promise(r => setTimeout(r, 1000));
    }

    await session.close();
    await client.disconnect();
  } catch (err) {
    console.error('Error:', err);
  }
}

test();
