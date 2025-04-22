# gardena-smart-system-node-red-flow
A flow for Node RED integrating the Gardena Smart System.

## General

This flow is intended for people who want to control their gardena smart system via Node RED.

As of now, the node can handle 

* Valves
* Mowers
* Sockets

that can be controlled via the Gardena/Husqvarna API.

### Prerequisites

* Register at https://developer.husqvarnagroup.cloud/
* Create an application
* Connect it to Gardena API (application details and then bottom > connect new api)

### Setup

When using one of the actions on the node, you'll need credentials. These should be easy to setup, pass in the app client ID and secret.

### Service IDs

When controlling anything, you'll need the service ID. In order to get these, use the `device_status` node which lists all devices that you can use. For each device, each service is listed include its ID.

Sadly, the services aren't really labeled, so you'll need to try out which is which.


## Notes

* Locations will be cached in the context. If you have location changes, just restart Node-RED to clear the flow context. If you don't know what a location is: Basically you can handle multiple houses/locations in one gardena account. If these change, try restarting Node RED and you run into issues.
* I wasn't able to test on many things, so basically the old saying "it works on my machine" applies. If something does not work, let me know.
* Gardena has rate limits, see [here](https://developer.husqvarnagroup.cloud/apis/gardena-smart-system-api?tab=readme#rate-limits) - keep those in mind! Do NOT setup too frequent calls to the API. For ongoing status requests, try to stick to something below one request every 30 minutes.