/* nbtemp.js */

var Template = (function () {
    const DEBUG_COMPILE = true

    var tags = {
        interpolate: /<%=([\s\S]+?)%>/g,
        comment: /<%#([\s\S]+?)%>/g,
        escape: /<%-([\s\S]+?)%>/g,
        evaluate: /<%([\s\S]+?)%>/g,
    }
    var tagMatcher = RegExp([
        tags.interpolate.source,
        tags.comment.source,
        tags.escape.source,
        tags.evaluate.source,
    ].join('|') + '|$', 'g')

    var blocks = {
        block: /block\(([\s\S]+?)\)/g,
        end: /end\(([\s\S]+?)\)/g,
        content: /(\$content)/g,
    }
    var blockMatcher = RegExp([
        blocks.block.source,
        blocks.end.source,
        blocks.content.source
    ].join('|') + '|$', 'g')

    var func = /[^\.](\w+?)\(([\s\S]+?)\)/g

    var escapes = {
        "'": "'",
        '\\': '\\',
        '\r': 'r',
        '\n': 'n',
        '\u2028': 'u2028',
        '\u2029': 'u2029'
    }
    var escapeRegExp = /\\|'|\r|\n|\u2028|\u2029/g
    function escapeChar(match) {
        return '\\' + escapes[match]
    }

    function scopeReplacer(stm, scope) {
        return stm.replace('@', scope + '.')
    }

    function env() {
        return '@ ' + JSON.stringify(arguments[0], null, 4)
            + '\nbuiltins ' + JSON.stringify(
                Object.keys(Template.builtins), null, 4)
            + '\ntemplates ' + JSON.stringify(
                Object.keys(Template.templates), null, 4)
    }

    function include(tmpl) {
        return Template.templates[tmpl]
    }

    Array.prototype.first = function() {
        return this[0]
    }
    Array.prototype.last = function() {
        return this[this.length - 1]
    }

    function Context(name, source) {
        var body = []
        var depth = 0, index = 0
        var block = {}
        var retStack = []
        var bodyStack = []

        var Ctx = []

        function LABEL(lbl) {
            let ret = ''
            for (let c of lbl)
                ret += String.fromCodePoint(c.codePointAt(0) + 65248)
            return `\n/* ${ret} */\t\t`
        }

        function RET(d) { return `__$r${d === undefined ? depth : d}` }
        function SCP(d) { return `__$s${d === undefined ? depth : d}` }
        function FUN(d) { return `__$f${d === undefined ? depth : d}` }
        function BLK(name, d) { return `__$blk_${name}${d === undefined ? depth : d }` }

        function Pre(name, source) {
            retStack.push(RET())
            bodyStack.push(body)
            //Ctx.push({ ret: RET(), block: null, depth: 0, index: 0 })

            Compile(Array.isArray(source) ? source : [source])
            body.push(`${LABEL('done')} return ${retStack.first()}`)
            console.dir(body)
            return body.flat(Infinity).join('')
        }

        function Compile(sources) {
            var source = sources[0]
            var ret = retStack.last()

            body.push(`${LABEL('comp')} /* src${depth} */`)
            body.push(`${LABEL('decl')} var ${ret} = ''`)

            index = 0
            source.replace(tagMatcher, Tag)

            if (sources.slice(1)[0]) {
                NextSource()
                Compile(sources.slice(1))
                AppendLastSource()
            }
        }

        function NextSource() {
            depth++
            retStack.push(RET())
            bodyStack.push(body)
        }

        function AppendLastSource() {
            var retPrev = retStack.pop()
            var ret = retStack.last()
            body.push(`${LABEL('appd')} ${ret} += ${retPrev}`)
        }

        function Tag(match, interpolate, comment, escape, evaluate, offset, str) {
            var ret = retStack.last()

            // copy outside of the tags
            body.push(`${LABEL('copy')} ${ret} += '`)
            body.push(str.slice(index, offset).replace(escapeRegExp, escapeChar))
            body.push(`'`)
            index = offset + match.length

            // tags
            if (interpolate)
                body.push(Interpolate(interpolate))
            if (comment)
                body.push(Comment(comment))
            if (escape)
                body.push(Escape(escape))
            if (evaluate)
                Evaluate(evaluate)

            return match
        }

        function Interpolate(str) {
            var ret = retStack.last()
            return `${LABEL('intp')} ${ret} += '' + ${scopeReplacer(str, SCP())}`
        }

        function Comment(str) {
            return `${LABEL('comm')}`
        }

        function Escape(str) {
            return `${LABEL('escp')}`
        }

        function Evaluate(str) {
            str.replace(blockMatcher, Block)
            //body.push(`${LABEL('eval')}`)
        }

        function Block(match, beginBlock, endBlock, content, offset, str) {
            if (beginBlock)
                BeginBlock(beginBlock.replace(/['"]/g, ''))
            if (endBlock)
                EndBlock(endBlock.replace(/['"]/g, ''))
            if (content)
                Content(content)
            return match
        }

        function BlockHead(name) {
            bodyStack.push(body)
            if (!block[name]) {
                body.push([])
                body = body.last()
                block[name] = {
                    head: body,
                    tail: null,
                }
            } else {
                body = block[name].head
            }
        }

        function BlockTail(name) {
            bodyStack.push(body)
            if (!block[name].tail) {
                body.push([])
                body = body.last()
                block[name].tail = body
            } else {
                body = block[name].tail
            }
        }

        function BeginBlock(name) {
            var blk = BLK(name)
            retStack.push(blk)
            BlockHead(name)
            body.push(`${LABEL('bblk')} var ${blk} = ''`)
        }

        function EndBlock(name) {
            var blk = retStack.pop()
            var ret = retStack.last()
            body = bodyStack.pop()
            BlockTail(name)
            if (block[name].prev)
                ret = block[name].prev
            block[name].prev = blk
            body.unshift(`${LABEL('eblk')} ${ret} += ${blk}`)
            body = bodyStack.pop()
        }

        function Content(name) {
            // set up for accumulating srcₙ₊₁ content
            //BeginBlock(name)
            //EndBlock(name)
        }

        function FunctionCall(match, identifier, args, offset, str) {
        }

        return Pre(name, source)
    }

    var anonCount = 0
    class Template extends Function {
        constructor(name, body) {
            if (body === undefined) {
                body = name;
                name = 'anonymous' + anonCount++
            }
            let _body = Context(name, body)
            if (DEBUG_COMPILE)
                console.log(_body)
            super(_body)
            this.body = body
            this.fname = name
            Template.templates[name] = this
        }
    }

    Template.templates = {}
    Template.builtins = {}
    Template.builtins.put = function(a) { return a ? '' + a : '' }
    Template.builtins.escape = function() { return '' }
    Template.builtins.env = env
    Template.builtins.include = include
    return Template
}).call(this)

// new Template(``)

// new Template(`<%= null; %>a<% null; %>`)

//new Template(`<% block('one') %>abc<% end('one') %>`)

// new Template([`<% block('one') %>abc<% end('one') %>`,
// `<% block('one') %>123<% end('one') %>`])

// var t = new Template([
//     `<% block('one') %>abc<% end('one') %>`,
//     `<% block('one') %>123<% end('one') %>`,
//     `<% block('one') %>xyz<% end('one') %>`
// ])

// var t = new Template([
//     `<% block('one') %>abc<% end('one') %>`,
//    `123`,
//     `<% block('one') %>xyz<% end('one') %>`
// ])


var t = new Template([
    `<% block('one') %>abc<% end('one') %>`,
    `<% block('one') %>123<% end('one') %>`,
    `xyz`
])

// var t = new Template([
// `<% block('one') %>111<% end('one') %>
// <% $content %>
// <% block('two') %>222<% end('two') %>`
// ,
// `front<% block('one') %>aaa<% end('one') %>middle
// <% block('two') %>bbb<% end('two') %>back`
// ])
// console.log(t())

// var t = new Template([
// `<% block('one') %>111<% end('one') %>
// <% $content %>
// <% block('two') %>222<% end('two') %>`
// ,
// `front<% block('one') %>aaa<% end('one') %>middle
// <% block('two') %>bbb<% end('two') %>back`
// ,
// `xyz`
// ])
// console.log(t())

// var t = new Template([
// `<% block('one') %>111<% end('one') %>
// <% $content %>
// <% block('two') %>222<% end('two') %>`
// ,
// `front<% block('one') %>aaa<% end('one') %>middle
// <% block('two') %>bbb<% end('two') %>back
// <% $content %>`
// ])
// console.log(t())

// var t = new Template([
// `<% block('one') %>111<% end('one') %>
// <% $content %>
// <% block('two') %>222<% end('two') %>`
// ,
// `front<% block('one') %>aaa<% end('one') %>middle
// <% block('two') %>bbb<% end('two') %>back
// <% $content %>`
// ,
// `xyz`
// ])
// console.log(t())

// var t = new Template([
//     `<% block('one') %><% end('one') %>`
// ])

// var t = new Template([
//     `<% $content %>`,
// ])

// var t = new Template([
//     `<% block('one') %><% end('one') %>`,
//     `<% block('one') %><% end('one') %>`
// ])

// var t = new Template([
//     `<% $content %>`,
//     `<% $content %>`,
// ])