# Atlassian Addon Helper

This project helps you extend your existing express app to serve as an Atlassian Addon (e.g. Jira or Confluence).  The package is meant to be used with express and will create the necessary endpoints you would need to register your add on with the Atlassian Product of choice.

Although it was created for Nexus-based apps, it is not opinionated about the project using it.

## What is this?

To understand what this is you should probably read up about how to develop Atlassian Addons.  
Developing Atlassian Addons is fully documented here:

* https://developer.atlassian.com/cloud/jira/platform/integrating-with-jira-cloud/
* https://developer.atlassian.com/cloud/confluence/about-connect/

And each app has different ways of extending them.

For Jira:
* https://developer.atlassian.com/cloud/jira/platform/about-jira-modules/

For Confluence
* https://developer.atlassian.com/cloud/confluence/modules/

## How To Use

All you really need to do is instantiate the AtlassianAddon class and pass in the parameters that are fully described
in the `srd/index.ts` file's  `IAtlassianDescriptor` interface.

The Atlassian Addon class creates the environment in which requests from an Atlassian product can be received and processed.  This will handle automatic production of the descriptor file as well as generating the installed and uninstalled endpoints.

It will also handle storage of the client information in a local store that is configured via the
dbConnectionString constructor parameter.  

We use Keyv to store this information. For more information
about Keyv and the possible connection strings, visit https://github.com/lukechilds/keyv

### Note 
This library is a full replacement for the `Atlassian Connect Express` library but should only be used in these cases:

* You need something that works better with Typescript
* You would like more control over the endpoints.

I say that because the Atlassian Connect Express package is fully supported by Atlassian while this is not which means
it will likely trail behind on changes.


