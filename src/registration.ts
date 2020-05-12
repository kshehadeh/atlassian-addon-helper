import urljoin from "url-join";
import axios from "axios";
import {IJiraConnection, logger} from "./index";

/**
 * You must request a UPM token before adding an addon programmatically
 * @param server The Jira server details
 * @return Returns the upm token if successful.
 */
export async function getUpmToken(server:IJiraConnection): Promise<string> {
    const request = getAxiosConfig('get', server, "application/vnd.atl.plugins.installed+json",  {os_authType: 'basic'});
    await axios(request).then((res) => {
        if (res.headers.hasOwnProperty('upm-token')) {
            return res.headers['upm-token'];
        }
    });
    return undefined;
}

/**
 * Installs an addon programmatically
 * @param server The Jira server details
 * @param upmToken The UPM token that was retrieved using getUpmToken
 * @param descriptorUrl The URL to the descriptor
 * @param name The name of the addon being added as it will appear in the manage addons list.
 * @return Returns true if the request to add it was submitted.
 */
export async function installApp(server: IJiraConnection, upmToken: string, descriptorUrl: string, name: string): Promise<boolean> {
    const request = getAxiosConfig('post', server,
        "application/json",
        {"token": upmToken},
        {"pluginUri": descriptorUrl,"pluginName": name}
    );

    return await axios(request).then((res) => {
        if (res.status > 200 && res.status < 300) {
            return true;
        } else {
            logger(`Failed to install Jira Addon on the server. Status: ${res.status}, ${res.statusText}`);
            return false;
        }
    }).catch((err) =>{
        logger("Failed to install Jira Addon on the server due to an exception: " + err.toString());
        return false;
    })
}

/**
 * Removes an addon programmatically
 * @param server The Jira server details
 * @param addonKey The key of the addon to remove.
 * @return Returns true if the request to remove it was submitted successfully.
 */
export async function removeApp(server: IJiraConnection, addonKey: string): Promise<boolean> {
    const request = getAxiosConfig('delete', server,
        "application/json",
        undefined,
        undefined,
        "/" + addonKey + "-key"
    );

    return await axios(request).then((res) => {
        if (res.status > 200 && res.status < 300) {
            return true;
        } else {
            logger(`Failed to remove Jira Addon on the server. Status: ${res.status}, ${res.statusText}`);
            return false;
        }
    }).catch((err) =>{
        logger("Failed to remove Jira Addon on the server due to an exception: " + err.toString());
        return false;
    })
}

/**
 * Puts together the entirety of the request that is to be passed into the axios request.
 * @param method The http method to use
 * @param server The server details including host and credentials for basic auth
 * @param mimeType The mime type to accept in responses.
 * @param params (optional) The query parameters as an object.
 * @param data (optional) The json body as an object
 * @param path (optional) The path to add to the end of the URL constructor.
 */
function getAxiosConfig(method: string, server:IJiraConnection, mimeType: string, params?: any, data?: any, path?: string): any {

    let url = urljoin(server.host, '/rest/plugins/1.0');
    if (path) {
        url = urljoin(url, path);
    }

    const authBase64 = new Buffer(`${server.username}:${server.apiToken}`).toString('base64');
    return {
        method,
        url,
        params,
        data,
        headers: {
            "Accept": mimeType,
            "Authorization": `Basic ${authBase64}`
        }
    }
}

