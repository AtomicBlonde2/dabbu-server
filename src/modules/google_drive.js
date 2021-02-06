/* Dabbu Server - a unified API to retrieve your files and folders stored online
 * Copyright (C) 2021  gamemaker1
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * 
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 * 
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

// MARK: Imports

// Files library, used to do all file operations across platforms
const fs = require("fs-extra")
// Used to detect mime types based on file content
const mmmagic = require("mmmagic")
// Used to make HTTP request to the Google Drive API endpoints
const axios = require("axios")

// Custom errors we throw
const { NotFoundError, BadRequestError, FileExistsError, GeneralError } = require("../errors.js")
// Used to generate platform-independent file/folder paths
const { diskPath } = require("../utils.js")

// Import the default Provider class we need to extend
const Provider = require("./provider.js").default

// MARK: Variables

// Instantiate the mime library
const mimeLib = new mmmagic.Magic(mmmagic.MAGIC_MIME_TYPE)

// MARK: Functions

// Get the folder ID based on its name
async function getFolderId(instance, folderName, parentId = "root", isShared = false, insertIfNotFound = false) {
  // If it's the root folder, return `root` as the ID
  if (folderName === "/") {
    return "root"
  }

  // Query the Drive API
  const result = await instance.get("/drive/v2/files", {
    params: {
      q: isShared 
          ? `title='${folderName}' and mimeType='application/vnd.google-apps.folder' and sharedWithMe = true`
          : `'${parentId}' in parents and title='${folderName}' and mimeType='application/vnd.google-apps.folder'`,
      fields: `items(id, title)`
    }
  })
  
  if (result.data.items.length > 0) {
    // If there is a valid result, return the folder ID
    const folderId = result.data.items[0].id
    return folderId
  } else {
    // There is no such folder
    if (insertIfNotFound) {
      // Insert a folder if the `insertIfNotFound` option is true
      await instance.post(`/drive/v2/files`, {
        "title": folderName,
        parents: [{id: parentId}],
        mimeType: "application/vnd.google-apps.folder"
      })
    } else {
      // Else error out
      throw new NotFoundError(`Folder ${folderName} does not exist`)
    }
  }
}

// Get the folder ID of the last folder in the path
async function getFolderWithParents(instance, folderPath, isShared = false, insertIfNotFound = false) {
  // If it's the root folder, return `root` as the ID
  if (folderPath === "/") {
    return "root"
  }

  // Else sanitise the folder path by removing empty names
  const folderNames = folderPath.split("/")
  var i = 0
  while (i < folderNames.length) {
    if (folderNames[i] === "") {
      folderNames.splice(i, 1)
    }
    i++
  }

  if (folderNames.length > 1) {
    // If the path has multiple folders, loop through them, get their IDs and 
    // then get the next folder ID with it as a parent
    var prevFolderId = "root"
    for (var j = 0, length = folderNames.length; j < length; j++) {
      prevFolderId = await getFolderId(instance, folderNames[j], prevFolderId, isShared)
    }
    // Return the ID of the last folder
    return prevFolderId
  } else {
    // Return the last and only folder's ID
    return await getFolderId(instance, folderNames[folderNames.length - 1], "root", isShared, insertIfNotFound)
  }
}

// Get the ID of a file based on its name
async function getFileId(instance, fileName, parentId = "root", isShared = false, errorOutIfExists = false) {
  // Query the Drive API
  const result = await instance.get("/drive/v2/files", {
    params: {
      q: isShared 
        ? `title='${fileName}' and sharedWithMe = true`
        : `'${parentId}' in parents and title = '${fileName}'`,
      fields: `items(id, title)`
    }
  })
  
  if (result.data.items.length > 0) {
    // If there is a valid result:
    if (errorOutIfExists) {
      // If the `errorOutIfExists` option is true (used when creating a file), error out
      throw new FileExistsError(`File ${fileName} already exists`)
    } else {
      // Else return the file ID
      const fileId = result.data.items[0].id
      return fileId
    }
  } else {
    // File doesn't exist
    if (!errorOutIfExists) {
      // If the `errorOutIfExists` option is false (used when creating a file), error out
      throw new NotFoundError(`File ${fileName} does not exist`)
    }
  }
}

// Get the file ID of a file with a folder path before it
async function getFileWithParents(instance, filePath, isShared = false) {
  // Parse the path
  var folderNames = filePath.split("/")
  // Get the file name and remove it from the folder path
  const fileName = folderNames.pop()

  // Sanitize the folder names by removing empty folder namess
  var i = 0
  while (i < folderNames.length) {
    if (folderNames[i] === "") {
      folderNames.splice(i, 1)
    }
    i++
  }

  if (folderNames.length > 0) {
    // If the path has multiple folders, loop through them, get their IDs and 
    // then get the next folder ID with it as a parent
    var prevFolderId = "root"
    for (var j = 0, length = folderNames.length; j < length; j++) {
      prevFolderId = await getFolderId(instance, folderNames[j], prevFolderId, isShared)
    }
    // Return the file ID with the parent ID being the last folder's ID
    return await getFileId(instance, fileName, prevFolderId, isShared)
  } else {
    // Get the file ID
    return await getFileId(instance, fileName, "root", isShared)
  }
}

// Get a valid mime type to export the file to for certain Google Workspace files
function getExportTypeForDoc(fileMimeType) {
  // Google Docs ---> Microsoft Word (docx)
  if (fileMimeType === "application/vnd.google-apps.document") {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  }
  // Google Sheets ---> Microsoft Excel (xlsx)
  if (fileMimeType === "application/vnd.google-apps.spreadsheet") {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  }
  // Google Slides ---> Microsoft Power Point (pptx)
  if (fileMimeType === "application/vnd.google-apps.presentation") {
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  }
  // Google Drawing ---> PNG Image (png)
  if (fileMimeType === "application/vnd.google-apps.drawing") {
    return "image/png"
  }
  // Google App Script ---> JSON (json)
  if (fileMimeType === "application/vnd.google-apps.script+json") {
    return "application/json"
  }
  // Google Maps and other types are not yet supported, don't know what they would 
  // return if a get request was tried on them
  return "auto"
}

// MARK: GoogleDriveDataProvider

class GoogleDriveDataProvider extends Provider {
  constructor() {
    super()
  }

  // List files and folders at a particular location
  async list(providerData, headers, params, queries) {
    // Get the access token from the header
    const accessToken = headers["Authorization"] || headers["authorization"]
    // Create an axios instance with the header. All requests will be made with this 
    // instance so the headers will be present everywhere
    const instance = axios.create({
      baseURL: "https://www.googleapis.com/",
      headers: {"Authorization": accessToken}
    })

    // Get the folder path from the URL
    const folderPath = diskPath(params["folderPath"].replace("Shared", ""))
    // Get the export type from the query parameters
    const exportType = queries["exportType"]
    // Should we search among shared files?
    const isShared = diskPath(params["folderPath"]) === "/Shared"

    // Don't allow relative paths, let clients do th
    if (diskPath(folderPath).indexOf("..") !== -1) {
      throw new BadRequestError(`Folder paths must not contain relative paths`)
    }

    // Get the folder ID (exception is if the folder name is Shared)
    const folderId = await getFolderWithParents(instance, folderPath, isShared)

    // Query the Drive API
    const listResult = await instance.get(`/drive/v2/files`, {
      params: {
        // If the folder path is /Shared, return all the files in the Shared Folder
        q: isShared ? `trashed = false and sharedWithMe = true` : `'${folderId}' in parents and trashed = false`,
        fields: `items(id, title, mimeType, fileSize, createdDate, modifiedDate, webContentLink, exportLinks)`
      }
    })

    if (listResult.data.items.length > 0) {
      // If a valid result is returned, loop through all the files and folders there
      var fileObjs = []
      for (var i = 0, length = listResult.data.items.length; i < length; i++) {
        const fileObj = listResult.data.items[i]
        const name = fileObj.title // Name of the file
        const kind = fileObj.mimeType == "application/vnd.google-apps.folder" ? "folder" : "file" // File or folder
        const filePath = diskPath(folderPath, name) // Absolute path to the file
        const mimeType = fileObj.mimeType // Mime type
        const size = fileObj.fileSize // Size in bytes, let clients convert to whatever unit they want
        const createdAtTime = fileObj.createdDate // When it was created
        const lastModifiedTime = fileObj.modifiedDate // Last time the file or its metadata was changed
        const exportMimeType = getExportTypeForDoc(mimeType)
        let contentURI = null
        // If the export type is media, then return a googleapis.com link
        if (exportType === "media") {
          contentURI = `https://www.googleapis.com/drive/v3/files/${fileObj.id}?alt=media`
        } else if (exportType === "view") {
          contentURI = `https://drive.google.com/open?id=${fileObj.id}`
        } else {
          // Else:
          // First check that it is not a Google Doc/Sheet/Slide/Drawing/App Script
          if (exportMimeType === "auto") {
            // If not, then give the web content link (only downloadable by browser)
            contentURI = fileObj.webContentLink
          } else {
            // Else it is a Doc/Sheet/Slide/Drawing/App Script
            // If the requested export type is in the exportLinks field, return that link
            if (fileObj.exportLinks[exportType]) {
              contentURI = fileObj.exportLinks[exportType]
            } else {
              // Else return the MS format of it
              contentURI = fileObj.exportLinks[exportMimeType]
            }
          }
        }

        // Append to a final array that will be returned
        fileObjs.push({
          name, kind, filePath, mimeType, size, createdAtTime, lastModifiedTime, contentURI
        })
      }
      // Return all the files as a final array
      return fileObjs
    } else {
      // Empty folder
      return []
    }
  }

  // Return a file obj at a specified location
  async read(providerData, headers, params, queries) {
    // Get the access token from the header
    const accessToken = headers["Authorization"] || headers["authorization"]
    // Create an axios instance with the header. All requests will be made with this 
    // instance so the headers will be present everywhere
    const instance = axios.create({
      baseURL: "https://www.googleapis.com/",
      headers: {"Authorization": accessToken}
    })

    // Get the folder path from the URL
    const folderPath = diskPath(params["folderPath"])
    // Get the file path from the URL
    const fileName = params["fileName"]
    // Get the export type from the query parameters
    const exportType = queries["exportType"]
    // TODO: Support params like order and compare by
    var {compareWith, operator, value, orderBy, direction} = queries

    // Don't allow relative paths, let clients do that
    if (diskPath(folderPath, fileName).indexOf("..") !== -1) {
      throw new BadRequestError(`Folder paths must not contain relative paths`)
    }
    
    // Get the folder and file ID
    const folderId = await getFolderWithParents(instance, folderPath)
    const fileId = await getFileId(instance, fileName, folderId)
    
    // Query the Drive API
    const listResult = await instance.get(`/drive/v2/files`, {
      params: {
        q: `title='${fileName}' and '${folderId}' in parents and trashed = false`,
        fields: `items(id, title, mimeType, fileSize, createdDate, modifiedDate, defaultOpenWithLink, webContentLink, exportLinks)`
      }
    })

    if (listResult.data.items.length > 0) {
      // If we get a valid result
      const fileObj = listResult.data.items[0]
      if (fileObj.id === fileId) {
        const name = fileObj.title // Name of the file
        const kind = fileObj.mimeType == "application/vnd.google-apps.folder" ? "folder" : "file" // File or folder
        const filePath = diskPath(folderPath, name) // Absolute path to the file
        const mimeType = fileObj.mimeType // Mime type
        const size = fileObj.fileSize // Size in bytes, let clients convert to whatever unit they want
        const createdAtTime = fileObj.createdDate // When it was created
        const lastModifiedTime = fileObj.modifiedDate // Last time the file or its metadata was changed
        const exportMimeType = getExportTypeForDoc(mimeType)
        let contentURI = null
        // If the export type is media, then return a googleapis.com link
        if (exportType === "media") {
          contentURI = `https://www.googleapis.com/drive/v3/files/${fileObj.id}?alt=media`
        } else if (exportType === "view") {
          contentURI = `https://drive.google.com/open?id=${fileObj.id}`
        } else {
          // Else:
          // First check that it is not a Google Doc/Sheet/Slide/Drawing/App Script
          if (exportMimeType === "auto") {
            // If not, then give the web content link (only downloadable by browser)
            contentURI = fileObj.webContentLink
          } else {
            // Else it is a Doc/Sheet/Slide/Drawing/App Script
            // If the requested export type is in the exportLinks field, return that link
            if (fileObj.exportLinks[exportType]) {
              contentURI = fileObj.exportLinks[exportType]
            } else {
              // Else return the MS format of it
              contentURI = fileObj.exportLinks[exportMimeType]
            }
          }
        }

        // Return the file metadata and content
        return {
          name, kind, filePath, mimeType, size, createdAtTime, lastModifiedTime, contentURI
        }
      } else {
        // We have a different file with the same name
        throw new NotFoundError(`Invalid file ID returned: There seems to be a different file with the same name here.`)
      }
    } else {
      // Not found
      throw new NotFoundError(`The file ${fileName} does not exist`)
    }
  }

  // Create a file at a specified location
  async create(providerData, headers, params, queries, fileMeta) {
    // Get the access token from the header
    const accessToken = headers["Authorization"] || headers["authorization"]
    // Create an axios instance with the header. All requests will be made with this 
    // instance so the headers will be present everywhere
    const instance = axios.create({
      baseURL: "https://www.googleapis.com/",
      headers: {"Authorization": accessToken}
    })

    // Get the folder path from the URL
    const folderPath = diskPath(params["folderPath"])
    // Get the file path from the URL
    const fileName = params["fileName"]

    // Don't allow relative paths, let clients do that
    if (diskPath(folderPath, fileName).indexOf("..") !== -1) {
      throw new BadRequestError(`Folder paths must not contain relative paths`)
    }

    // Get the folder ID
    const folderId = await getFolderWithParents(instance, folderPath, true)
    
    // Check if the file already exists
    await getFileId(instance, fileName, folderId, true)

    // Detect the file's mime type
    const fileMimeType = await new Promise((resolve, reject) => {
      mimeLib.detectFile(fileMeta.path, function(err, result) {
        if (err) reject(err)
        resolve(result)
      })
    })

    // First, post the file meta data to let Google Drive know we are posting the file's contents too
    const driveMeta = await instance.post(`/drive/v2/files`, {
      "title": fileName,
      parents: [{id: folderId}],
      mimeType: fileMimeType
    })

    if (driveMeta.data) {
      // If drive acknowledges the request, then upload the file as well
      const file = driveMeta.data
      return await instance.put(`/upload/drive/v2/files/${file.id}?uploadType=media`, fs.createReadStream(fileMeta.path))
    } else {
      // Else throw an error
      throw new GeneralError(500, "No response from Google Drive. Cancelling file upload.", "invalidResponse")
    }
  }

  // Update the file at the specified location with the file provided
  async update(providerData, headers, params, queries, fileMeta) {
    // Get the access token from the header
    const accessToken = headers["Authorization"] || headers["authorization"]
    // Create an axios instance with the header. All requests will be made with this 
    // instance so the headers will be present everywhere
    const instance = axios.create({
      baseURL: "https://www.googleapis.com/",
      headers: {"Authorization": accessToken}
    })

    // Get the folder path from the URL
    const folderPath = diskPath(params["folderPath"])
    // Get the file path from the URL
    const fileName = params["fileName"]

    // Don't allow relative paths, let clients do that
    if (diskPath(folderPath, fileName).indexOf("..") !== -1) {
      throw new BadRequestError(`Folder paths must not contain relative paths`)
    }

    // Get the folder and file ID
    const folderId = await getFolderWithParents(instance, folderPath, false)
    const fileId = await getFileId(instance, fileName, folderId, false)

    // Get the new mime type of the file
    const fileMimeType = await new Promise((resolve, reject) => {
      mimeLib.detectFile(fileMeta.path, function(err, result) {
        if (err) reject(err)
        resolve(result)
      })
    })

    // Upload the new file
    return await instance.put(`/upload/drive/v2/files/${fileId}?uploadType=media`, fs.createReadStream(fileMeta.path))
  }

  // Delete the file or folder at the specified location
  async delete(providerData, headers, params, queries) {
    // Get the access token from the header
    const accessToken = headers["Authorization"] || headers["authorization"]
    // Create an axios instance with the header. All requests will be made with this 
    // instance so the headers will be present everywhere
    const instance = axios.create({
      baseURL: "https://www.googleapis.com/",
      headers: {"Authorization": accessToken}
    })

    // Get the folder path from the URL
    const folderPath = diskPath(params["folderPath"])
    // Get the file path from the URL
    const fileName = params["fileName"]

    // Don't allow relative paths, let clients do that
    if (diskPath(folderPath).indexOf("..") !== -1) {
      throw new BadRequestError(`Folder paths must not contain relative paths`)
    }

    if (folderPath && fileName) {
      // If there is a file name provided, delete the file
      const filePath = diskPath(folderPath, fileName)

      // Get the file ID
      const fileId = await getFileWithParents(instance, filePath)

      // Delete the file
      return await instance.delete(`/drive/v2/files/${fileId}`)
    } else if (folderPath && !fileName) {
      // If there is only a folder name provided, delete the folder
      // Get the folder ID
      const folderId = await getFolderWithParents(instance, folderPath)

      // Delete the folder
      return await instance.delete(`/drive/v2/files/${folderId}`)
    } else {
      // Else error out
      throw new BadRequestError(`Must provide either folder path or file path to delete`)
    }
  }
}

// MARK: Exports

// Export the GoogleDriveDataProvider as the default export
exports.default = GoogleDriveDataProvider