"use strict";

const ApiGateway = require("moleculer-web");
const { UnAuthorizedError, MoleculerClientError } = ApiGateway.Errors;
const cookie = require("cookie");
const Busboy = require("busboy");
const fs = require("fs").promises;
const { createWriteStream } = require('fs');
const path = require("path");
const crypto = require("crypto");

const Config = require("config-service");

module.exports = {
	name: "api",
	version: 1,
	mixins: [
		ApiGateway,
		Config.Mixin
	],

	metadata: {},

	// More info about settings: https://moleculer.services/docs/0.13/moleculer-web.html
	settings: {
		port: 4000,
		ip: '0.0.0.0',
		log4XXResponses: true,
		logRequestParams: "debug",
		// Logging the response data. Set to any log level to enable it. E.g. "info"
		logResponseData: "debug",
		debounceTime: 5000,
		use: [

		],

		cors: {
			// Configures the Access-Control-Allow-Origin CORS header.
			origin: "*",
			// Configures the Access-Control-Allow-Methods CORS header. 
			methods: '*',
			// Configures the Access-Control-Allow-Headers CORS header.
			allowedHeaders: '*',
			// Configures the Access-Control-Expose-Headers CORS header.
			//exposedHeaders: '*',
			// Configures the Access-Control-Allow-Credentials CORS header.
			credentials: false,
			// Configures the Access-Control-Max-Age CORS header.
			maxAge: 3600
		},
		routes: [
			/**
			 * API routes
			 */
			{
				path: "/api",

				whitelist: [
					"**"
				],


				etag: true,

				camelCaseNames: true,

				authentication: true,
				//authorization: true,

				autoAliases: true,
				mergeParams: true,

				aliases: {
					"POST /v1/accounts/avatar"(req, res) {
						this.parseAvatarUploadedFile(req, res);
					},
				},

				// Use bodyparser modules
				bodyParsers: {
					json: { limit: "2MB" },
					urlencoded: { extended: true, limit: "2MB" }
				}
			}
		],

		config: {
			"http.root": "../public",
			"api.endpoint": "http://192.168.1.143:4000"
		},

	},

	actions: {

	},

	methods: {
		/**
		 * Authenticate from request
		 *
		 * @param {Context} ctx
		 * @param {Object} route
		 * @param {IncomingRequest} req
		 * @returns {Promise}
		 */
		async authenticate(ctx, route, req) {
			let token;

			// Get JWT token from Authorization header
			const auth = req.headers["authorization"];
			if (auth && auth.startsWith("Bearer ")) token = auth.slice(7);

			// Get JWT token from cookie
			if (!token && req.headers.cookie) {
				const cookies = cookie.parse(req.headers.cookie);
				token = cookies["jwt-token"];
			}

			ctx.meta.roles = ["public"];

			// Verify JWT token
			const user = await this.validateUserToken(ctx, token)

			if (!req.$endpoint) {
				return user
			}

			const permission = `${req.$endpoint.service.name}.${req.$endpoint.action.rawName}`

			let res = await ctx.call("v1.accounts.roles.hasAccess", { roles: ctx.meta.roles, permissions: [permission] });

			if (res !== true)
				throw new UnAuthorizedError(
					"You have no right for this operation!",
					401, "ERR_HAS_NO_ACCESS", { roles: ctx.meta.roles, permissions: [permission] }
				);

			return user
		},
		async validateUserToken(ctx, token) {
			if (token) {

				// Check the token in cache
				let user = this.authCache.get(token);
				if (!user) {
					user = await ctx.call("v1.accounts.resolveToken", { token });
					if (user) {
						this.authCache.set(token, user);
					} else {
						return null
					}
				}

				// remove public role
				ctx.meta.roles = ctx.meta.roles.filter(r => r !== "public");
				// Add authenticated role
				ctx.meta.roles.push("authenticated");
				// Add roles of user
				if (Array.isArray(user.roles)) ctx.meta.roles.push(...user.roles);
				// Set user & token to context meta
				ctx.meta.token = token;
				ctx.meta.userID = user.id;

				//strip any scope actions from params.
				if (!ctx.meta.roles.includes("administator")) {
					delete ctx.params.scope;
				}

				// Reduce user fields (it will be transferred to other nodes)
				return user;

			}
			return null;
		},

		async parseAvatarUploadedFile(req, res) {

			const busboy = Busboy({ headers: req.headers });
			let avatar;

			await new Promise((resolve, reject) => {
				busboy.on("file", (fieldname, file, info) => {
					if (fieldname === "avatar") {

						const filename = crypto.randomBytes(16).toString("hex");
						const ext = path.extname(info.filename);
						avatar = `${filename}${ext}`;

						const writeStream = createWriteStream(`/app/public/avatars/${avatar}`);
						file.pipe(writeStream);

						this.logger.info(`${req.socket.remoteAddress} uploading avatar`, info);
					}
				});
				busboy.on("close", resolve);
				busboy.on("error", reject);
				req.pipe(busboy);
			});

			if (!avatar) {
				res.statusCode = 400;
				res.end("No avatar file uploaded");
				return;
			}

			await this.broker.call("v1.accounts.updateAvatar", {
				id: req.$ctx.meta.userID,
				avatar: `${this.config.get("api.endpoint")}/avatars/${avatar}`,
			});

			res.statusCode = 200;
			res.end();
		},

	},


	/**
	 * Service created lifecycle event handler
	 */
	created() {
		this.authCache = new Map();
	},

	/**
	 * Service started lifecycle event handler
	 */
	async started() {

	},

	/**
	 * Service stopped lifecycle event handler
	 */
	async stopped() {

	}
};
