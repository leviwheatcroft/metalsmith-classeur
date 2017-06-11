# metalsmith-classeur

![nodei.co](https://nodei.co/npm/metalsmith-classeur.png?downloads=true&downloadRank=true&stars=true)

![npm](https://img.shields.io/npm/v/metalsmith-classeur.svg)

![github-issues](https://img.shields.io/github/issues/leviwheatcroft/metalsmith-classeur.svg)

![stars](https://img.shields.io/github/stars/leviwheatcroft/metalsmith-classeur.svg)

![forks](https://img.shields.io/github/forks/leviwheatcroft/metalsmith-classeur.svg)

[metalsmith](https://metalsmith.io) to scrape content from classeur

Highlights:

 * fancy async stream for api requests
 * super easy setup

See the [annotated source][annotated source] or [github repo][github repo]

## install

`npm i --save github:leviwheatcroft/metalsmith-classeur`

## usage


### example

```javascript
Metalsmith('src')
.use(googleDrive({
  auth: config.get('driveAuth'),
  src: '0B1QpLgu4qk48R1hDBi1wWFkyV2s',
  dest: 'articles'
}))
.build( ... )
```

### options

 * `srcId` {String} (required) id of classeur folder you wish to scrape (get this from the shareable url for the folder
 * `destPath` {String} (required) the path under which you want to place the scraped files
 * `userId` {String} (required) userId from classeur
 * `apiKey` {String} (required) apiKey from classeur

## Author

Levi Wheatcroft <levi@wht.cr>

## Contributing

Contributions welcome; Please submit all pull requests against the master
branch.

## License

 - **MIT** : http://opensource.org/licenses/MIT

[annotated source]: https://leviwheatcroft.github.io/metalsmith-classeur "fancy annotated source"
[github repo]: https://github.com/leviwheatcroft/metalsmith-classeur "github repo"
