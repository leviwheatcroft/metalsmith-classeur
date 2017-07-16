import debug from 'debug'
import vow from 'vow'
import flashheart from 'flashheart'
import util from 'util'
import {
  Readable,
  Writable
} from 'stream'
import {
  join
} from 'path'
import {
  FileCache,
  ValueCache
} from 'metalsmith-cache'

const dbg = debug('metalsmith-classeur')
const host = 'https://app.classeur.io'

/**
 * ### default
 *
 *
 * @param {Object} options
 * @param {String} options.srcId classeur folder id
 * @param {String} options.destPath path under which to place files
 * @param {Object} options.userId
 * @param {String} options.apiKey
 */
function plugin (options) {
  if (!options) throw new Error('no options passed')
  if (!options.srcId) throw new Error('required: options.srcId')
  if (!options.destPath) throw new Error('required: options.destPath')
  if (!options.userId) throw new Error('required: options.userId')
  if (!options.apiKey) throw new Error('required: options.apiKey')
  // if (options.cache !== undefined) cache = options.cache
  const folder = new Folder(options)
  return folder.classeur.bind(folder)
}

class Folder {
  constructor (options) {
    Object.assign(this, options)
    this.fileCache = new FileCache(`classeur-${options.srcId}`)
    this.valueCache = new ValueCache(`classeur-${options.srcId}`)
    this.initClient(options.userId, options.apiKey)
  }
  initClient (username, password) {
    this.client = flashheart.createClient({
      name: module.exports.name,
      userAgent: util.format(
        '%s/%s (%s)',
        module.exports.name,
        module.exports.version,
        flashheart.createClient().userAgent
      ),
      defaults: {
        auth: {username, password}
      }
    })
  }
  classeur (files, metalsmith) {
    this.files = files
    this.metalsmith = metalsmith
    return vow.resolve()
    .then(() => this._invalidate())
    .then(() => this.scrape())
    .then(() => this.mergeStore())
    // implement lastRun here
    // .then(() => this.valueCache.store('lastRun', new Date().toISOString()))
    .then(() => vow.resolve(this.files))
    .catch((err) => {
      if (err === 'skip') return dbg('skipped scrape')
      dbg(err)
    })
  }
  _invalidate () {
    if (this.invalidate || this.invalidateCache) {
      return vow.all([
        this.fileCache.invalidate(),
        this.valueCache.invalidate()
      ])
    }
  }
  /**
   * ## scrape
   * pipes fileIds from readable to writable managing workers
   *
   * @param {string} srcId
   */
  scrape () {
    dbg('scrape', this.srcId)
    const defer = vow.defer()
    const stream = this.streamFiles()
    stream.on('error', defer.reject.bind(defer))
    const worker = this.processFiles()
    // can't use 'finish' event bacause async write fn
    worker.on('done', defer.resolve.bind(defer))
    worker.on('error', defer.reject.bind(defer))

    // now kiss!
    stream.pipe(worker)

    return defer.promise()
  }

  /**
   * ### streamFiles
   * creates a readable stream to read file ids from api as required
   * requests 20 files at a time
   * can implement an `updatedAt` filter here
   *
   * @param {String} parent id of parent folder
   */
  streamFiles () {
    const folder = this
    return Object.assign(
      new Readable({
        objectMode: true,
        highWaterMark: 60
      }),
      {
        // buffer docs ready to be pushed to outbound stream buffer
        toPush: [],
        // flag to ensure we don't request again if already awaiting request
        // and `_read` is called
        requested: false,
        // flag for whether EOF has been reached
        exhausted: false,
        count: 0,
        _read: function _read () {
          this._next()
        },
        _next: function _next () {
          // if our toPush is empty, request more
          if (!this.toPush.length) return this._request()
          // push oldest item
          const oldest = this.toPush.shift()
          if (this.push(oldest)) {
            // then go again if this.push returned truthy
            return process.nextTick(this._next.bind(this))
          }
        },
        _request: function _request () {
          // block additional requests
          if (this.requested) return
          if (this.exhausted) return
          this.requested = true
          const opts = {
            qs: {
              sort: 'updated',
              direction: 'desc'
            },
            headers: {
              Range: `items=${this.count}-${this.count + 19}`
            }
          }
          const url = `${host}/api/v2/folders/${folder.srcId}/files`
          folder.client.get(url, opts, (err, body) => {
            if (err) throw new Error(err)
            this.count += body.length
            body.forEach((file) => {
              this.toPush.push(file)
            })
            if (body.length < 20) {
              // end of stream
              dbg(`scraped ${this.count} files`)
              this.toPush.push(null)
              this.exhausted = true
            } else {
              // not end of stream
            }
            this.requested = false
            this._next()
          })
        }
      }
    )
  }

  /**
   * ## processFiles
   * returns a writable stream which can spawn multiple workers to process
   * fileIds
   */
  processFiles () {
    const folder = this
    const writable = Object.assign(
      new Writable({
        objectMode: true,
        highWaterMark: 60
      }),
      {
        concurrency: 5, // configurable here
        workers: 0, // don't change this
        /**
         * ## _write
         * this is where the parallel stream magic happens..
         * each time `_write` is called, we either call `next` immediately (if
         * we haven't yet reached concurrency limit) or we call `next` once the
         * worker has finished.
         *
         * @param {Object} file pushed from streamFiles
         * @param {String} encoding ignored
         * @param {Function} next call when ready for subsequent worker to start
         */
        _write: function _write (file, encoding, next) {
          this.workers++
          vow.resolve(file)
          .then((file) => folder.downloadFile(file))
          .then((file) => folder.storeFile(file))
          .catch((err) => {
            dbg(err)
            dbg('worker errored')
          })
          .then(() => {
            this.workers--
            // emit 'done' after all async workers have completed
            if (this.isFinished && this.workers === 0) {
              this.emit('done')
            }
            next()
          })

          // if not at concurrency limit, call next immediately (don't wait for
          // worker to finish)
          if (this.workers < this.concurrency) {
            next()
            next = () => {}
          }
        }
      }
    )
    writable.on('finish', () => {
      // set flag so we can emit 'done' event after async write
      writable.isFinished = true
    })
    return writable
  }

  /**
   * ### downloadFile
   *
   * @param {Object} file as streadmed from _streamFiles
   */
  downloadFile (file) {
    dbg(`downloading "${file.name}"`)

    const defer = vow.defer()
    const url = `${host}/api/v2/files/${file.id}/contentRevs/last`
    this.client.get(url, {retries: 6}, (err, body) => {
      if (err) return defer.reject(new Error(err))
      file = Object.assign(file, body)
      file = this.coerceFile(file)
      defer.resolve(file)
    })
    return defer.promise()
  }

  /**
   * ## coerceFile
   * make the file a little more metalsmith
   */
  coerceFile (file) {
    file.contents = Buffer.from(file.text)
    delete file.text
    file.modifiedDate = new Date(file.updated)
    delete file.updated
    Object.assign(file, file.properties)
    delete file.properties
    return file
  }

  /**
   * ### storeFile
   *
   * store file in persist cache with drive id as key
   *
   * @param {Object} file
   */
  storeFile (file) {
    return this.fileCache.store(join(this.destPath, file.name), file)
  }
  /**
   * ### _getFiles
   *
   * this gets files from local persistent store
   *
   * @param {String} dest path under which to store files
   */
  mergeStore () {
    return this.fileCache.all()
    .then((files) => {
      const count = Object.keys(files).length
      dbg(`merging ${count} tracked files from ${this.srcId}`)
      Object.assign(this.files, files)
    })
  }
}

export default plugin
export {
  plugin
}
