# Dabbu Google Drive Data Provider

To install its dependencies, run: 

`npm install axios mmmagic`

# Provider specific variables
Requires an access token of the format `Bearer <token>` added to the header under the `Authorization` header field in every request. No provider data needs to be added to the request body.

# Google Drive specific features
## Shared files and permissions

- Currently, it is only possible to view and download files and folders shared with you (located in the hidden `/Shared` folder). Files and folders that you have shared with others will appear in their respective paths in your Drive. Sharing files and folders with others is not yet supported through this server module.