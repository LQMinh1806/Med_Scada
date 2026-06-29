import opcua from 'node-opcua';

const { OPCUAClient, MessageSecurityMode, SecurityPolicy, AttributeIds } = opcua;
const endpointUrl = process.env.OPCUA_ENDPOINT || 'opc.tcp://127.0.0.1:49320';

async function checkStatus() {
  const client = OPCUAClient.create({
    endpointMustExist: false,
    securityMode: MessageSecurityMode.None,
    securityPolicy: SecurityPolicy.None,
  });

  try {
    await client.connect(endpointUrl);
    const session = await client.createSession();

    const nodesToRead = [
      { nodeId: 'ns=2;s=PLC1.Cabin._System._Error', attributeId: AttributeIds.Value },
      { nodeId: 'ns=2;s=PLC1.Cabin._System._NoError', attributeId: AttributeIds.Value },
      { nodeId: 'ns=2;s=PLC1.Cabin._System._Simulated', attributeId: AttributeIds.Value },
      { nodeId: 'ns=2;s=PLC1.Cabin.Current_Station', attributeId: AttributeIds.Value }
    ];

    const dataValues = await session.read(nodesToRead);
    
    console.log('_Error:', dataValues[0].value?.value, dataValues[0].statusCode.name);
    console.log('_NoError:', dataValues[1].value?.value, dataValues[1].statusCode.name);
    console.log('_Simulated:', dataValues[2].value?.value, dataValues[2].statusCode.name);
    console.log('Current_Station:', dataValues[3].value?.value, dataValues[3].statusCode.name);

    await session.close();
    await client.disconnect();
  } catch (err) {
    console.error('Error:', err);
  }
}

checkStatus();
