import { IRouter, NextFunction, Request, Response } from "express";
import Keyv from "keyv";
import { Application, Router } from "express";
import authenticationMiddleware from "./auth";
import bodyParser from "body-parser";
import debug from "debug";
import { Client } from "jira.js";

export const logger = debug('atlassian-addon-helper');

/**
 * All webhook events received will have a payload that looks something like this.
 */
export interface IWebhookPayload {
    timestamp: string,
    event: string,

    [index: string]: any
}

export interface IJiraConnection {
    host: string,
    username: string,
    apiToken: string,
    client?: Client
}

/**
 *  The signature of a webhook handler (regardless of which product it is coming from).
 * To see webhook payload possibilities, sees
 *  JIRA: https://developer.atlassian.com/cloud/jira/platform/webhooks/#example-callback-for-an-issue-related-event
 *  CONF: https://developer.atlassian.com/cloud/confluence/modules/webhook/
 */
type WebhookHandler = (
    payload: IWebhookPayload
) => Promise<boolean>

/**
 * This is the base interface for all modules that appear in a descriptor.  You will never use
 * this directly.  Look for the specific module definition below.
 */
export interface IDescriptorModule {
    key?: string
    description?: string
}

/**
 * Use this to register for a webhook event notification from the product.
 */
export interface IWebhookDefinition extends IDescriptorModule {
    event: string
    url?: string
    excludeBody?: boolean
    filter?: string
    propertyKeys?: string[]
}

/**
 * The webhook configuration interface associates a definition with a handler.
 */
export type WebhookConfiguration = {
    definition: IWebhookDefinition,
    handler: WebhookHandler
}

/**
 * This is the interface for the app descriptor object that is exposed to the Atlassian product when
 * installing the addon.
 */
export interface IAtlassianDescriptor {

    /**
     * The unique key of your add-on
     */
    key: string;

    /**
     * The friendly name of your addon
     */
    name: string;

    /**
     * A description of the add on as it will appear in the atlassian manage addons page.
     */
    description: string;

    /**
     * The vendor as it will appear in the atlassian manage addons page.
     */
    vendor?: {
        name: string;
        url: string;
    };

    /**
     * Type of authentication (can be jwt or none)
     */
    authentication: {
        type: string // 'jwt' | 'JWT' | 'none' | 'NONE'
    };

    /**
     * The base URL of your add on (e.g. https://example.com/atlassian/).
     * This is used to construct URLs that are exposed through the generator
     * descriptor file (for example, install and uninstall urls).
     */
    baseUrl: string;

    /**
     * Atlassian calls the different ways to integrate "modules".  Use this property
     * to populate the modules in your descriptor using the documentation available
     * on the Atlassian site:
     *  JIRA: https://developer.atlassian.com/cloud/jira/platform/about-jira-modules/
     *  CONF: https://developer.atlassian.com/cloud/confluence/modules/
     */
    modules?: {
        [index: string]: IDescriptorModule[],
    }

    /**
     * This will be populated automatically by the package.
     */
    links?: {
        self: string;
    };

    /**
     * The paths for the endpoints that atlassian will call when the addon is installed or uninstalled.
     * These will be populated for you.
     */
    lifecycle?: {
        installed: string;
        uninstalled: string;
    };

    /**
     * Whether or not to enable licensing options in the UPM/Marketplace for this app.
     */
    enableLicensing?: boolean;

    /**
     * Set of scopes requested by this app (read, write)
     */
    scopes?: string[];
}

/**
 * Use the Atlassian Addon class to create the environment in which requests from an Atlassian
 * product can be received and processed.  This will handle automatic production of the descriptor file
 * as well as generating the installed and uninstalled endpoints.
 *
 * It will also handle storage of the client information in a local store that is configured via the
 * dbConnectionString constructor parameter.  We use Keyv to store this information. For more information
 * about Keyv and the possible connection strings, visit https://github.com/lukechilds/keyv
 *
 */
export class AtlassianAddon {

    readonly subApp: Application;

    protected _descriptorData: IAtlassianDescriptor;
    protected _maxTokenAge: number;
    protected _db: Keyv;
    protected _metaRouter: IRouter;
    protected _addonPath: string;
    protected _jira: IJiraConnection;    

    /**
     * Instantiate an AtlassianAddon object
     * @param params Descriptor parameters that are fully documented in IAtlassianDescriptor
     * @param subApp This is an Express application object - it can be the top level or a sub application (the latter
     *                  is recommended because it avoids endpoint collisions.
     * @param addonPath This is the sub path *after* the baseUrl to use for all generated endpoints.  For example, if
     *                  the baseUrl is `https://example.com/my/path` then the addonPath might be `/jira/addon`
     * @param dbConnectionString The Keyv connection string to use.  For possibilities see the Keyv documentation
     *                  available here: https://github.com/lukechilds/keyv
     * @param maxTokenAge When a session token is created by the addon, this is the amount of time in seconds that
     *                  it will take for the token to expire after creation.
     * @param jiraConnection If given, the addon will be able to check if it's registered as well as be 
     *                  be able to register and unregister itself.
     */
    public constructor(
        params: IAtlassianDescriptor,
        subApp: Application,
        addonPath: string,
        dbConnectionString?: string,
        maxTokenAge?: number,
        jiraConnection?: IJiraConnection) {

        const defaults = {
            scopes: [
                "read", "write"
            ]
        };

        this._jira = jiraConnection;
        if (this._jira) {
            this._jira.client = new Client({
                host: this._jira.host,
                authentication: {
                    basic: {
                        username: this._jira.username,
                        apiToken: this._jira.apiToken
                    }
                }
            });
        }
        
        this._maxTokenAge = maxTokenAge || 15 * 60;

        // The descriptor data that was passed in here will be used
        //  to output the  JSON requested by Jira when installing or getting
        //  information about the addon.
        this._descriptorData = Object.assign({}, defaults, params);

        this._addonPath = addonPath;

        // Modify the baseUrl to include the jira addon portion.  This will be used as the stem for all
        //  calls  into this  addon so it  should include the this._addonPath portion at the beginning.
        this._descriptorData.baseUrl += this._addonPath;

        this.subApp = subApp;

        // If no connection string is given then we will assume  that we
        //  are using  sqlite _db in place here.
        if (!dbConnectionString) {
            dbConnectionString = "sqlite://addon.sqlite";
        }

        // Initialize  the  database that will be holding the client information.
        //  Note that  the client information will be keyed on the client
        //  key which will be given at the time of installation of the
        //  addon.  The client details  are used to decode JWTs that  are
        //  passed in during callback (like webhooks).
        this._db = new Keyv(dbConnectionString, {namespace:this._descriptorData.key});

        // Ensure that we we  have the lifecycle endpoints created a
        //  and  ready to accept install/uninstall  and descriptor requests.
        this.addLifecycleEndpoints();
    }

    get api(): Client {
        return this._jira ? this._jira.client : undefined;
    }

    get maxTokenAge(): number {
        return this._maxTokenAge;
    }

    get app(): Application {
        return this.subApp;
    }

    get name(): string {
        return this._descriptorData.name;
    }

    get key(): string {
        return this._descriptorData.key;
    }

    get baseUrl(): string {
        return this._descriptorData.baseUrl;
    }

    get description(): string {
        return this._descriptorData.description;
    }

    get scopes(): string[] {
        return this._descriptorData.scopes;
    }

    get skipQshVerification(): boolean {
        return true;
    }

    /**
     * Specifically returns the shared secret value from the client data associated with the given clientKey
     * @param clientKey The client key is the key that is received from Atlassian during installation
     */
    public async getSharedSecret(clientKey: string): Promise<string> {
        return this.getClientData(clientKey, "sharedSecret");
    }

    /**
     * This will add the installed and uninstalled handlers to the stored router
     * and automatically add/remove the client information to/from storage.
     *
     * After this is returned there will be an /installed and an /uninstalled
     * endpoint at the root of the  given router.
     */
    public addLifecycleEndpoints() {

        if (this._metaRouter) {
            logger("Trying to reinitialize lifecycle endpoints.   Skipping...");
            return;
        }

        // The meta router is the root for the endpoints used for
        //  installation, uninstallation and descriptor requests from Jira.
        this._metaRouter = Router();
        // Ensure that JSON payload bodies are parsed and ready for usage by
        //  all downstream routes.
        this._metaRouter.use(bodyParser.json());
        this.subApp.use(`${this._addonPath}/meta`, this._metaRouter);

        //// this builds out the lifecycle property of the descriptor.  Done this
        //  way to reduce the logic involved in checking whether one, both or neither
        //  of the lifecycle properties exist.s
        this._descriptorData.lifecycle = {
            installed: "/meta/installed",
            uninstalled: "/meta/uninstalled"
        };

        //// SETUP INSTALLED CALLBACK
        this._metaRouter.post("/installed", async (req: Request, res: Response) => {
            const clientData = req.body;
            if (!clientData || !clientData.clientKey) {
                return AtlassianAddon.sendError(500,"Received malformed installation payload from Jira", res);
            }

            await this._db.set(clientData.clientKey, clientData);
            return AtlassianAddon.sendError(200, "Installation completed successfully", res);
        });

        //// SETUP UNINSTALLED CALLBACK
        this._metaRouter.post("/uninstalled", async (req: Request, res: Response) => {
            const clientData = req.body;
            if (!clientData || !clientData.clientKey) {
                return AtlassianAddon.sendError(500, "Received malformed installation payload from Jira", res );
            }
            await this._db.delete(clientData.clientKey);
            return AtlassianAddon.sendError(200, "Uninstall completed successfully", res);
        });

        //// DESCRIPTOR ENDPOINT
        this._metaRouter.get(
            `/descriptor`,
            (_req, res: Response) => {
                res.json(this.toJson());
            }
        );
    }

    /**
     * This will add the given webhooks and install a new request handler
     * on the stored route router.
     * @param webhooks
     */
    public addWebhooks(webhooks: WebhookConfiguration[]) {

        const base = `/webhook`;
        const route = `${this._addonPath}${base}/:event`;

        /**
         * What's happening here:
         *  1. Ensure the descriptor data exposes the correct values
         *      by including the webhooks specified in the given configuration
         *      The `definition` part of the configuration should map to the
         *      same shape as specified in the webhook portion of the app
         *      descriptor:
         *          https://developer.atlassian.com/cloud/jira/platform/modules/webhook/
         *
         *  2. The URL is being calculated for you.  So if the configuration
         *      contains a url it will be replaced.
         */
        if (!this._descriptorData.modules) {
            this._descriptorData.modules = {};
        }
        if (!this._descriptorData.modules.webhooks) {
            this._descriptorData.modules.webhooks = [];
        }
        webhooks.forEach((wh: WebhookConfiguration) => {
            wh.definition.url = `${base}/${wh.definition.event}`;
            this._descriptorData.modules.webhooks.push(wh.definition);
        });

        /**
         * This is the request handler for the actual webhook events.
         *  Notes:
         *      1. The authentication middleware verifies the payload
         *          by decoding the jwt, extracting the client key
         *          and verifying the payload with the shared secret.
         *      2. If successfully verified then this will call the handler
         *          specified during initialization in the WebhookConfiguration
         *          typed properties in the connection configuration.
         */
        this.subApp.post(route,
            bodyParser.json(),
            authenticationMiddleware(this),
            async (req: Request, res: Response, next: NextFunction) => {

                const event = req.params.event;
                if (!event) {
                    const msg = "Received an event from Jira but the event parameter was not set which suggests that the URL was setup incorrectly";
                    logger(msg);
                    next(new Error(msg));
                }

                try {
                    if (!req.body) {
                        logger("Received a webhook event but no pre-processing of the body has been done.  Make sure and add a body parser middleware to the route");
                        return;
                    }

                    const payload: IWebhookPayload = req.body;

                    // Do a search of the stored webhook configurations looking
                    //  for the one with the matching event name.  If found, then
                    //  call the handler, otherwise return a
                    const index = webhooks.findIndex((wh) => wh.definition.event === payload.webhookEvent);
                    if (index >= 0) {
                        await webhooks[index].handler(payload);
                        return AtlassianAddon.sendError(200, "Event handled successfully", res);
                    } else {
                        logger(`Webhook event handler not found for ${req.body.event}`);
                        return AtlassianAddon.sendError(404, "Event handler not found", res);
                    }
                } catch (e) {
                    logger("Unable to handle a webhook event that  was received from Jira: " + e.toString());
                    return AtlassianAddon.sendError(500, "Exception thrown during handling of webhook event", res);
                }
            });
    }

    /**
     * Returns the descriptor data in a form that is easily convertible to a JSON string.
     */
    public toJson() {
        return this._descriptorData;
    }


    /**
     * Returns the client data associated with the given client key and property from
     * the data store that was given in the constructor.
     * @param clientKey The client key is the key that is received from Atlassian during installation
     * @param key The name of the property to retrieve the value for.
     */
    protected async getClientData(clientKey: string, key: string) {
        const data = await this._db.get(clientKey);
        if (data && key in data) {
            return data[key];
        } else {
            return undefined;
        }
    }

    /**
     * Generates a consistent error response
     * @param code The code to use for the error
     * @param msg The message to use
     * @param res The response object passed in with the request.
     */
    static sendError(code: number, msg: string, res: Response) {
        res.status(code).json({ code, msg });
    }
}
