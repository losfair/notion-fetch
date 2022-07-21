// https://github.com/remorses/react-notion-x/blob/d023dcdc3103199b828c1065e1d13f2c1c80088d/packages/notion-client/src/types.ts

import * as notion from 'notion-types'

export interface SignedUrlRequest {
  permissionRecord: PermissionRecord
  url: string
}

export interface PermissionRecord {
  table: string
  id: notion.ID
}

export interface SignedUrlResponse {
  signedUrls: string[]
}
