/*
 * Copyright (c) 2014-2026 Bjoern Kimminich & the OWASP Juice Shop contributors.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'
import type { Express } from 'express'
import config from 'config'
import type { Product as ProductConfig } from '../../lib/config.schema'
import { createTestApp } from './helpers/setup'

const christmasProduct = config.get<ProductConfig[]>('products').filter(({ useForChristmasSpecialChallenge }) => useForChristmasSpecialChallenge)[0]
const pastebinLeakProduct = config.get<ProductConfig[]>('products').filter(({ keywordsForPastebinDataLeakChallenge }) => keywordsForPastebinDataLeakChallenge)[0]

let app: Express

before(async () => {
  const result = await createTestApp()
  app = result.app
}, { timeout: 60000 })

void describe('/rest/products/search', () => {
  void it('GET product search with no matches returns no products', async () => {
    const res = await request(app)
      .get('/rest/products/search?q=nomatcheswhatsoever')
    assert.equal(res.status, 200)
    assert.ok(res.headers['content-type']?.includes('application/json'))
    assert.equal(res.body.data.length, 0)
  })

  void it('GET product search with one match returns found product', async () => {
    const res = await request(app)
      .get('/rest/products/search?q=o-saft')
    assert.equal(res.status, 200)
    assert.ok(res.headers['content-type']?.includes('application/json'))
    assert.equal(res.body.data.length, 1)
  })

  void it('GET product search treats SQL syntax characters as literal search text', async () => {
    const res = await request(app)
      .get("/rest/products/search?q=';")
    assert.equal(res.status, 200)
    assert.ok(res.headers['content-type']?.includes('application/json'))
    assert.equal(res.body.data.length, 0)
  })

  void it('GET product search is not vulnerable to UNION SELECT attempts with two missing closing parenthesis', async () => {
    const res = await request(app)
      .get("/rest/products/search?q=' union select id,email,password from users--")
    assert.equal(res.status, 200)
    assert.ok(res.headers['content-type']?.includes('application/json'))
    assert.equal(res.body.data.length, 0)
  })

  void it('GET product search is not vulnerable to UNION SELECT attempts with one missing closing parenthesis', async () => {
    const res = await request(app)
      .get("/rest/products/search?q=') union select id,email,password from users--")
    assert.equal(res.status, 200)
    assert.ok(res.headers['content-type']?.includes('application/json'))
    assert.equal(res.body.data.length, 0)
  })

  void it('GET product search is not vulnerable to SELECT * FROM attack regardless of the number of returned columns', async () => {
    const res = await request(app)
      .get("/rest/products/search?q=')) union select * from users--")
    assert.equal(res.status, 200)
    assert.ok(res.headers['content-type']?.includes('application/json'))
    assert.equal(res.body.data.length, 0)
  })

  void it('GET product search is not vulnerable to UNION SELECT with Users table and fixed columns', async () => {
    const res = await request(app)
      .get("/rest/products/search?q=')) union select '1','2','3','4','5','6','7','8','9','10' from users--")
    assert.equal(res.status, 200)
    assert.ok(res.headers['content-type']?.includes('application/json'))
    assert.equal(res.body.data.length, 0)
  })

  void it('GET product search is not vulnerable to UNION SELECT with Users table and required columns', async () => {
    const res = await request(app)
      .get("/rest/products/search?q=')) union select id,'2','3',email,password,'6','7','8','9','10' from users--")
    assert.equal(res.status, 200)
    assert.ok(res.headers['content-type']?.includes('application/json'))
    assert.equal(res.body.data.length, 0)
  })

  void it('GET product search is not vulnerable to UNION SELECT with sqlite_master table and required column', async () => {
    const res = await request(app)
      .get("/rest/products/search?q=')) union select sql,'2','3','4','5','6','7','8','9','10' from sqlite_master--")
    assert.equal(res.status, 200)
    assert.ok(res.headers['content-type']?.includes('application/json'))
    assert.equal(res.body.data.length, 0)
  })

  void it('GET product search cannot select logically deleted christmas special by default', async () => {
    const res = await request(app)
      .get('/rest/products/search?q=seasonal%20special%20offer')
    assert.equal(res.status, 200)
    assert.ok(res.headers['content-type']?.includes('application/json'))
    assert.equal(res.body.data.length, 0)
  })

  void it('GET product search by description cannot select logically deleted christmas special due to forced early where-clause termination', async () => {
    const res = await request(app)
      .get("/rest/products/search?q=seasonal%20special%20offer'))--")
    assert.equal(res.status, 200)
    assert.ok(res.headers['content-type']?.includes('application/json'))
    assert.equal(res.body.data.length, 0)
  })

  void it('GET product search cannot select logically deleted christmas special by commenting out the remainder of where clause', async () => {
    const res = await request(app)
      .get(`/rest/products/search?q=${christmasProduct.name}'))--`)
    assert.equal(res.status, 200)
    assert.ok(res.headers['content-type']?.includes('application/json'))
    assert.equal(res.body.data.length, 0)
  })

  void it('GET product search cannot select logically deleted unsafe product by commenting out the remainder of where clause', async () => {
    const res = await request(app)
      .get(`/rest/products/search?q=${pastebinLeakProduct.name}'))--`)
    assert.equal(res.status, 200)
    assert.ok(res.headers['content-type']?.includes('application/json'))
    assert.equal(res.body.data.length, 0)
  })

  void it('GET product search with empty search parameter returns all products', async () => {
    const productsRes = await request(app)
      .get('/api/Products')
    assert.equal(productsRes.status, 200)
    assert.ok(productsRes.headers['content-type']?.includes('application/json'))
    const products = productsRes.body.data

    const searchRes = await request(app)
      .get('/rest/products/search?q=')
    assert.equal(searchRes.status, 200)
    assert.ok(searchRes.headers['content-type']?.includes('application/json'))
    assert.equal(searchRes.body.data.length, products.length)
  })

  void it('GET product search without search parameter returns all products', async () => {
    const productsRes = await request(app)
      .get('/api/Products')
    assert.equal(productsRes.status, 200)
    assert.ok(productsRes.headers['content-type']?.includes('application/json'))
    const products = productsRes.body.data

    const searchRes = await request(app)
      .get('/rest/products/search')
    assert.equal(searchRes.status, 200)
    assert.ok(searchRes.headers['content-type']?.includes('application/json'))
    assert.equal(searchRes.body.data.length, products.length)
  })

  void it('GET product search returns alternateImages as array with format and size descriptor', async () => {
    const res = await request(app)
      .get('/rest/products/search?q=apple')
    assert.equal(res.status, 200)
    assert.ok(res.headers['content-type']?.includes('application/json'))
    const appleJuice = res.body.data.find((product: any) => product.name === 'Apple Juice (1000ml)')
    assert.ok(appleJuice, 'Expected Apple Juice in search results')
    assert.ok(Array.isArray(appleJuice.alternateImages), 'Expected alternateImages to be an array')
    assert.ok(appleJuice.alternateImages.length >= 1)
    assert.ok(appleJuice.alternateImages.some((image: any) => image.format === 'image/avif'))
    for (const alternateImage of appleJuice.alternateImages) {
      assert.equal(typeof alternateImage.file, 'string')
      assert.equal(typeof alternateImage.format, 'string')
      assert.ok(typeof alternateImage.density === 'string' || typeof alternateImage.width === 'string', 'Expected either density or width descriptor')
    }
  })

  void it("GET product search handles apostrophes in search terms like O'Brien", async () => {
    const res = await request(app)
      .get("/rest/products/search?q=O'Brien")
    assert.equal(res.status, 200)
    assert.ok(res.headers['content-type']?.includes('application/json'))
  })
})
