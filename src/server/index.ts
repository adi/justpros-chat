import {
	type Connection,
	Server,
	type WSMessage,
	routePartykitRequest,
} from "partyserver";

import type { ChatMessage, Message } from "../shared";

export class Chat extends Server<Env> {
	static options = { hibernate: true };

	messages = [] as ChatMessage[];

	broadcastMessage(message: Message, exclude?: string[]) {
		this.broadcast(JSON.stringify(message), exclude);
	}

	// Handle HTTP requests (for server-to-server broadcast)
	async onRequest(request: Request): Promise<Response> {
		const url = new URL(request.url);

		// POST /broadcast - broadcast a notification to all connected clients
		if (request.method === "POST" && url.pathname.endsWith("/broadcast")) {
			try {
				const body = (await request.json()) as { message?: string };
				const notificationMessage = body.message || "new_message";

				// Broadcast notification to all connected WebSocket clients
				this.broadcastMessage({
					type: "notification",
					message: notificationMessage,
				});

				return new Response("OK", { status: 200 });
			} catch {
				return new Response("Bad Request", { status: 400 });
			}
		}

		return new Response("Not Found", { status: 404 });
	}

	onStart() {
		// this is where you can initialize things that need to be done before the server starts
		// for example, load previous messages from a database or a service

		// create the messages table if it doesn't exist
		this.ctx.storage.sql.exec(
			`CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, user TEXT, role TEXT, content TEXT)`,
		);

		// load the messages from the database
		this.messages = this.ctx.storage.sql
			.exec(`SELECT * FROM messages`)
			.toArray() as ChatMessage[];
	}

	onConnect(connection: Connection) {
		connection.send(
			JSON.stringify({
				type: "all",
				messages: this.messages,
			} satisfies Message),
		);
	}

	saveMessage(message: ChatMessage) {
		// check if the message already exists
		const existingMessage = this.messages.find((m) => m.id === message.id);
		if (existingMessage) {
			this.messages = this.messages.map((m) => {
				if (m.id === message.id) {
					return message;
				}
				return m;
			});
		} else {
			this.messages.push(message);
		}

		this.ctx.storage.sql.exec(
			`INSERT INTO messages (id, user, role, content) VALUES ('${
				message.id
			}', '${message.user}', '${message.role}', ${JSON.stringify(
				message.content,
			)}) ON CONFLICT (id) DO UPDATE SET content = ${JSON.stringify(
				message.content,
			)}`,
		);
	}

	onMessage(connection: Connection, message: WSMessage) {
		// let's broadcast the raw message to everyone else
		this.broadcast(message);

		// let's update our local messages store
		const parsed = JSON.parse(message as string) as Message;
		if (parsed.type === "add" || parsed.type === "update") {
			this.saveMessage(parsed);
		}
	}
}

export default {
	async fetch(request, env) {
		return (
			(await routePartykitRequest(request, { ...env })) ||
			env.ASSETS.fetch(request)
		);
	},
} satisfies ExportedHandler<Env>;
