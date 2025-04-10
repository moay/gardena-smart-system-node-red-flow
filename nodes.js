module.exports = function(RED) {
    const axios = require('axios');
    const deserialize = require('json-api-deserialize');
    const { URLSearchParams } = require('url');
    const gardena = require('./client/GardenaApiClient.js')(axios, URLSearchParams, deserialize);

    function ApiCredentialsNode(n) {
        RED.nodes.createNode(this, n);
    }
    RED.nodes.registerType('api-credentials', ApiCredentialsNode, {
    	credentials: {
            application: { type: 'text' },
            password: { type: 'password' }
        }
    });

    function GardenaDevicesStatusNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const credentials = RED.nodes.getCredentials(config.api);
        setNodeStatusBasedOnGardenaApiConnection(node, credentials);

        node.on('input', function(msg) {
            if (!credentials) {
                node.error('Credentials are not properly setup. Cannot contact Gardena Api.');
                return;
            }
            setNodeStatusBasedOnGardenaApiConnection(node, credentials);
            gardena
            	.getAllDevicesStatusAsync()
            	.then(function(response) {
	            	msg.payload = response;
	            	node.send(msg);
            	})
                .catch(function(response) {
                    node.error(response);
                });
        });
    }
    RED.nodes.registerType("devices_status", GardenaDevicesStatusNode);

    function GardenaServiceStatusNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const serviceId = config.service;
        const serviceType = config.servicetype;
        
        node.on('input', function(msg) {
            let serviceFound = false;
            const inputData = msg.payload;
            if (!Array.isArray(inputData)) {
                node.warn('Obtained data seems not to be coming from the Gardena Devices Status node. Cannot find service data.');
                return;
            }
            inputData.forEach(function(location) {
                if (!location.devices || !Array.isArray(location.devices)) {
                    node.warn('Obtained data seems not to be coming from the Gardena Devices Status node. Cannot find service data.');
                    return;
                }
                location.devices.forEach(function(device) {
                    if (serviceFound || !device.services) {
                        return;
                    }
                    device.services.forEach(function(deviceService) {
                        if (deviceService.id === serviceId && deviceService.type === serviceType) {
                            serviceFound = true;
                            msg.payload = deviceService;
                        }
                    });
                });
            });
            if (!serviceFound) {
                node.error('Could not find service in node input data.');
                return;
            }
            node.send(msg);
        });
    }
    RED.nodes.registerType("service_status", GardenaServiceStatusNode);


    function GardenaValveControlNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const credentials = RED.nodes.getCredentials(config.api);
        setNodeStatusBasedOnGardenaApiConnection(node, credentials);

        node.on('input', function(msg) {
            if (!credentials) {
                node.error('Credentials are not properly setup. Cannot contact Gardena Api.');
                return;
            }
            setNodeStatusBasedOnGardenaApiConnection(node, credentials);
            const duration = config.durationtype === 'msg' ? (resolveNestedProperty(msg, config.duration) || 1) : config.duration;
            gardena
                .sendValveControlAsync(config.service, config.operation, duration)
                .then(function(response) {
                    msg.payload = response;
                    node.send(msg);
                })
                .catch(function(response) {
                    node.error(response);
                    node.status({
                        fill: 'orange',
                        shape: 'ring',
                        text: 'Request error'
                    })
                });
        });
    }
    RED.nodes.registerType("valve_control", GardenaValveControlNode);

    function GardenaMowerControlNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const credentials = RED.nodes.getCredentials(config.api);
        setNodeStatusBasedOnGardenaApiConnection(node, credentials);

        node.on('input', function(msg) {
            if (!credentials) {
                node.error('Credentials are not properly setup. Cannot contact Gardena Api.');
                return;
            }
            setNodeStatusBasedOnGardenaApiConnection(node, credentials);
            const duration = config.durationtype === 'msg' ? (resolveNestedProperty(msg, config.duration) || 1) : config.duration;
            gardena
                .sendMowerControlAsync(config.service, config.operation, duration)
                .then(function(response) {
                    msg.payload = response;
                    node.send(msg);
                })
                .catch(function(response) {
                    node.error(response);
                    node.status({
                        fill: 'orange',
                        shape: 'ring',
                        text: 'Request error'
                    })
                });
        });
    }
    RED.nodes.registerType("mower_control", GardenaMowerControlNode);

    function GardenaPowerSocketControlNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const credentials = RED.nodes.getCredentials(config.api);
        setNodeStatusBasedOnGardenaApiConnection(node, credentials);

        node.on('input', function(msg) {
            if (!credentials) {
                node.error('Credentials are not properly setup. Cannot contact Gardena Api.');
                return;
            }
            setNodeStatusBasedOnGardenaApiConnection(node, credentials);
            const duration = config.durationtype === 'msg' ? (resolveNestedProperty(msg, config.duration) || 1) : config.duration;
            gardena
                .sendPowerSocketControlAsync(config.service, config.operation, duration)
                .then(function(response) {
                    msg.payload = response;
                    node.send(msg);
                })
                .catch(function(response) {
                    node.error(response);
                    node.status({
                        fill: 'orange',
                        shape: 'ring',
                        text: 'Request error'
                    })
                });
        });
    }
    RED.nodes.registerType("powersocket_control", GardenaPowerSocketControlNode);

    function setNodeStatusBasedOnGardenaApiConnection(node, credentials) {
        if (credentials) {
            gardena
                .setCredentials(credentials)
                .setFlowContext(node.context().flow)
                .getLoginStatusAsync()
                .then(function(connected) {
                    if (connected) {
                        node.status({
                            fill: 'green',
                            shape: 'dot',
                            text: 'Connected'
                        })
                    } else {
                        node.status({
                            fill: 'red',
                            shape: 'ring',
                            text: 'Could not connect'
                        })
                    }
                });
        } else {
            node.status({
                fill: 'red',
                shape: 'ring',
                text: 'Credentials missing'
            })
        }
    }
}

function resolveNestedProperty(object, path) {
    const properties = Array.isArray(path) ? path : path.split('.')
    
    return properties.reduce(function(prev, curr) {
        return prev && prev[curr]
    }, object);
}