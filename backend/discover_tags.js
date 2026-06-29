import opcua from 'node-opcua';

const { OPCUAClient, MessageSecurityMode, SecurityPolicy } = opcua;
const endpointUrl = process.env.OPCUA_ENDPOINT || 'opc.tcp://127.0.0.1:49320';

async function browse() {
  const client = OPCUAClient.create({
    endpointMustExist: false,
    securityMode: MessageSecurityMode.None,
    securityPolicy: SecurityPolicy.None,
  });

  try {
    await client.connect(endpointUrl);
    const session = await client.createSession();

    const browseResult = await session.browse('ns=2;s='); // Root of Kepware user tags
    for (const ref of browseResult.references) {
      console.log(`- ${ref.browseName.toString()} (${ref.nodeId.toString()})`);
    }

    await session.close();
    await client.disconnect();
  } catch (err) {
    console.error('Error:', err);
  }
}

browse();
