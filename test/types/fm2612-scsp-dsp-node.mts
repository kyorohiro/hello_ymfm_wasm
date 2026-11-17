// Node MessagePort transports remain structurally compatible with the client.
import type {MessagePort} from 'node:worker_threads';
import {createScspClient} from 'tetorica-fm2612/playground_scsp.js';
import {createScspClient as createBareScspClient} from 'tetorica-fm2612/playground_scsp';
import type {ScspClient, ScspClientPort} from 'tetorica-fm2612/playground_scsp';

declare const port:MessagePort;
const transport:ScspClientPort = port;
const client:ScspClient = createScspClient(port);
const bareClient:ScspClient = createBareScspClient(port);
const codes:Promise<{codes:number[]}> = client.setDspCoefficients({0:2048});
void [transport, client, bareClient, codes];
