const util = require("util")

class AuthenticationClient {
	constructor(credentials, axios, URLSearchParams, flowContext) {
		this.credentials = credentials;
		this.axios = axios;
		this.URLSearchParams = URLSearchParams;
		this.flowContext = flowContext;
		this.authenticationClient = null;

		this.validateStoredData();
	}

	async getAuthenticationToken() {
		const flow = this.flowContext;
		const authenticationClient = this;

		if (this.authenticationPromise && util.inspect(this.authenticationPromise).includes("pending")) {
			return this.authenticationPromise;
		}

		return new Promise(function(resolve, reject) {
			flow.get('gardena_access_token', async function(error, accessToken) {
				if (error) {
					reject('Storage error.');
				}
				let token;
				if (!accessToken) {
					try {
						token = await authenticationClient.authenticateWithoutToken();
					} catch (e) {
						console.debug(e.status)
						reject();
					}
					resolve(token);
				} else {
					flow.get('gardena_access_token_expires_at', async function(error, expiresAt) {
						if (error) {
							reject('Storage error.');
						}
						if (!expiresAt || expiresAt <= Date.now()/1000) {
							authenticationClient.invalidateStoredToken();
							token = await authenticationClient.authenticateWithoutToken();
						} else {
							token = accessToken;	
						}
						
						resolve(token);	
					});
				}
			});
		});
	}

	async authenticateWithoutToken() {
		console.debug('Obtaining access token')
		const baseUrl = 'https://api.authentication.husqvarnagroup.dev/v1/oauth2/token';
		const params = new this.URLSearchParams();
		
		params.set('grant_type', 'client_credentials');
		params.set('client_id', this.credentials.application);
		params.set('client_secret', this.credentials.password);

		let response
		try {
			response = await this.axios.post(baseUrl, params);
		} catch (e) {
			console.debug(e.response)
		}
		if (!response || response.status !== 200) {
			throw new Error('Could not authenticate to Gardena API. Probably your credentials are wrong.');
		}

		this.storeAccessToken(response.data);

		return response.data.access_token;
	}

	storeAccessToken(tokenResponse) {
		this.flowContext.set("gardena_access_token", tokenResponse.access_token);
		const now = Date.now()/1000;
		this.flowContext.set("gardena_access_token_expires_at", now + tokenResponse.expires_in - 10);
		this.flowContext.set("gardena_storage_hash", this.getStorageHash());
	}

	invalidateStoredToken() {
		this.flowContext.set("gardena_access_token", undefined);
		this.flowContext.set("gardena_access_token_expires_at", undefined);
		this.flowContext.set("gardena_storage_hash", 'invalidated');
	}

	validateStoredData() {
		const hash = this.getStorageHash();
		const storedHash = this.flowContext.get('gardena_storage_hash');

		if (hash !== storedHash) {
			this.invalidateStoredToken();
		}
	}

	getStorageHash() {
		return JSON.stringify(hashCode(this.credentials));
	}
}

class GardenaApiClient {
	constructor(axios, URLSearchParams) {
		this.axios = axios;
		this.URLSearchParams = URLSearchParams;
		this.deserializer = new JSONApiResponseDeserializer();
	}

	setCredentials(credentials) {
		this.credentials = credentials;
		return this;
	}

	setFlowContext(flowContext) {
		this.flowContext = flowContext;
		return this;
	}

	async getLoginStatusAsync() {
		try {
			await this.prepareAuthenticationTokenAsync();
		} catch (e) {
			return false;
		}
		return true;
	}

	async getAllDevicesStatusAsync() {
		const devices = [];
		const locations = await this.getLocationsAsync();
		const locationIds = Object.keys(locations);
		const self = this;

		await Promise.all(locationIds.map(async function(locationId) {
			const locationDevices = await self.getLocationDevicesAsync(locationId);
			devices.push(locationDevices);
		}));

		return devices;
	}

	async getLocationDevicesAsync(locationId) {
		const devicesResponse = await this.sendAuthenticatedRequestAsync('GET', `locations/${locationId}`);
		if (devicesResponse.status !== 200) {
			throw new Error('Unable to get devices data from Gardena API.');
		}

		return this.deserializer.deserialize(devicesResponse.data);
	}

	async getLocationsAsync() {
		const self = this;
		return new Promise(function(resolve, reject) {
			self.flowContext.get("gardena_locations", async function(error, locations) {
				if (error || !locations) {
					const locationsResponse = await self.sendAuthenticatedRequestAsync('get', 'locations');
					if (locationsResponse.status !== 200) {
						reject(locationsResponse.data);
						return
					}
					const parsedLocations = self.parseLocations(locationsResponse.data.data);
					self.flowContext.set("gardena_locations", parsedLocations, function(error) {
						if (error) {
							reject('Unable to store locations in flow context.');
						} else {
							resolve(parsedLocations);
						}
					});
				} else {
					resolve (locations);
				}
			})
		})
	}

	async sendValveControlAsync(valveId, operation, duration) {
		return this.sendServiceControlAsync(valveId, operation, duration, 'VALVE_CONTROL')
	}

	async sendMowerControlAsync(valveId, operation, duration) {
		return this.sendServiceControlAsync(valveId, operation, duration, 'MOWER_CONTROL')
	}

	async sendPowerSocketControlAsync(valveId, operation, duration) {
		return this.sendServiceControlAsync(valveId, operation, duration, 'POWER_SOCKET_CONTROL')
	}

	async sendServiceControlAsync(serviceId, operation, duration, command) {
		const self = this;
		return new Promise(function(resolve, reject) {
			if (!serviceId) {
				reject('Service ID was not given. Setup node properly to run a command');
			}
			if (operation === 'START_SECONDS_TO_OVERRIDE' && !duration) {
				reject('Duration for command needs to be given in minutes, none given. Setup node properly to run a command');
			}

			self.sendAuthenticatedRequestAsync('put', `command/${serviceId}`, {
				data: {
					id: 'request',
					type: command,
					attributes: {
						command: operation,
						seconds: duration * 60,
					}
				}
			}).then(function(response) {
				if (response.status === 202) {
					resolve(response);
				}
				reject(response);
			}).catch(function(response) {
				reject(response);
			});
		});
	}

	async sendAuthenticatedRequestAsync(method, targetUrl, data, allowRetry = true) {
		const token = await this.prepareAuthenticationTokenAsync();
		const url = `https://api.smart.gardena.dev/v2/${targetUrl}`;
		const requestConfig = {
			url,
			method,
			headers: {
				'Authorization': `Bearer ${token}`,
				'X-Api-Key': this.credentials.application,
				'Content-Type': 'application/vnd.api+json',
			}
		};

		if (data) {
			requestConfig.data = data;
		}

		console.log('REQUEST DATA')
		console.debug(requestConfig)

		let response = null
		try {
			response = await this.axios.request(requestConfig);
		} catch(e) {
			if (alloweRetry && e && e.response && (
				e.response.status === 401 || e.response.status === 404
			)) {
				this.authenticationClient.invalidateStoredToken()
				response = await this.sendAuthenticatedRequestAsync(method, targetUrl, data, false)

			}
		}

		return new Promise((r) => r(response));
	}

	async prepareAuthenticationTokenAsync() {
		if (!this.authenticationClient) {
			this.authenticationClient = new AuthenticationClient(this.credentials, this.axios, this.URLSearchParams, this.flowContext);
		}
		
		let token;
		try {
			token = await this.authenticationClient.getAuthenticationToken();
		} catch (e) {
			// Retry
			this.authenticationClient.invalidateStoredToken();
			token = await this.authenticationClient.getAuthenticationToken();
		}

		return token;
	}

	parseLocations(locationsFromGardenaApi) {
		let parsedLocations = {};
		for (let i = 0; i < locationsFromGardenaApi.length; i += 1) {
			const location = locationsFromGardenaApi[i];
			if (location.type !== 'LOCATION' || !location.attributes) {
				continue;
			}
			parsedLocations[location.id] = location.attributes.name || 'Unknown location';
		}
		return parsedLocations;
	}
}

class JSONApiResponseDeserializer {
	deserialize(toDeserialize) {
		return this.resolveObject(toDeserialize.data, toDeserialize.included || [], null);
	}

	resolveObject(objectData, includedObjects, parentObject) {
		const self = this;
		const resolved = {};
		if (objectData.id) {
			resolved.id = objectData.id;
		}
		if (objectData.type) {
			resolved.type = objectData.type;
		}
		if (objectData.attributes) {
			Object.entries(objectData.attributes).forEach(function([key, value]) {
				resolved[key] = value;
			});
		}
		if (objectData.relationships) {
			Object.entries(objectData.relationships).forEach(function([key, value]) {
				const relatedObjects = self.resolveRelatedObjects(value.data, includedObjects, objectData, parentObject);
				if (relatedObjects) {
					resolved[key] = relatedObjects;
				}
			});
		}

		return resolved;
	}

	resolveRelatedObjects(objects, includedObjects, parentObject, grandParentObject) {
		const self = this;
		if (!Array.isArray(objects)) {
			// Only one object, resolve this
			const relatedObject = this.findRelationshipTarget(objects, includedObjects);
			if (!relatedObject || self.objectsAreTheSame(relatedObject, grandParentObject)) {
				return null;
			}
			return this.resolveObject(relatedObject, includedObjects, parentObject);
		} else {
			const resolved = [];
			objects.forEach(function(object) {
				const relatedObject = self.findRelationshipTarget(object, includedObjects);
				if (relatedObject && !self.objectsAreTheSame(relatedObject, grandParentObject)) {
					resolved.push(self.resolveObject(relatedObject, includedObjects, parentObject));
				}
			})
			return resolved.length > 0 ? resolved : false;
		}
	}

	findRelationshipTarget(relationshipObject, includedObjects) {
		return includedObjects.find(function(includedObject) {
			return relationshipObject.id === includedObject.id
				&& relationshipObject.type === includedObject.type
		})
	}

	objectsAreTheSame(object1, object2) {
		return object1 && object2
			&& object1.id === object2.id
			&& object1.type === object2.type;
	}
}

function hashCode(object) {
    let hash = 0;
    let char;
    if (object.length == 0) {
        return hash;
    }
    for (let i = 0; i < object.length; i++) {
        char = object.charCodeAt(i);
        hash = ((hash<<5)-hash)+char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString();
}

module.exports = (axios, URLSearchParams) => new GardenaApiClient(axios, URLSearchParams);