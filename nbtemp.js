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

    var funcs = {
        env: /(env)\s*\([\s\S]*\)/,
        include: /include\s*\(([\s\S]+?)\)/,
    }
    var funcMatcher = RegExp([
        funcs.env.source,
        funcs.include.source,
    ].join('|'))

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
        var cntBlock = false

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
        function CNT(d) { return `__$cnt${d}` }

        function Pre(name, source) {
            retStack.push(RET())
            bodyStack.push(body)
            body.push(`${LABEL('decl')} var ${SCP(0)} = arguments[0]`)
            body.push(`${LABEL('decl')} var ${FUN(0)} = {}`)
            for (let name in Template.builtins)
                body.push(`${LABEL('decl')} ${FUN(0)}.${name} = Template.builtins.${name}`)
            Compile(Array.isArray(source) ? source : [source])
            body.push(`${LABEL('done')} return ${retStack.first()}`)
            return body.flat(Infinity).join('')
        }

        function Compile(sources) {
            var source = sources[0]
            var ret = retStack.last()

            body.push(`${LABEL('comp')} /* src${depth} */`)
            if (!cntBlock)
                body.push(`${LABEL('decl')} var ${ret} = ''`)

            cntBlock = false
            index = 0
            source.replace(tagMatcher, Tag)

            if (sources.slice(1)[0]) {
                let d = depth
                let c = cntBlock
                NextSource(d, c)
                Compile(sources.slice(1))
                AppendLastSource(d, c)
            }
        }

        function NextSource(d, c) {
            depth++
            if (c) {
                BeginContent('$content', d, true)
            } else {
                retStack.push(RET())
                bodyStack.push(body)
            }
        }

        function AppendLastSource(d, c) {
            if (c) {
                EndContent('$content', d, true)
            } else {
                var retPrev = retStack.pop()
                var ret = retStack.last()
                body = bodyStack.pop()
                body.push(`${LABEL('appd')} ${ret} += ${retPrev}`)
            }
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
            return `${LABEL('intp')} ${ret} += '' + ${scopeReplacer(str, SCP(0))}`
        }

        function Comment(str) {
            return `${LABEL('comm')}`
        }

        function Escape(str) {
            return `${LABEL('escp')}`
        }

        function Evaluate(str) {
            var hack = { match: false }
            str.replace(blockMatcher, Block.bind(hack))
            if (!hack.match) {
                hack = { match: false }
                str.replace(funcMatcher, FunctionCall.bind(hack))
            }
            if (!hack.match)
                body.push(`${LABEL('eval')} ${scopeReplacer(str, SCP(0))}`)
        }

        function Block(match, beginBlock, endBlock, content, offset, str) {
            if (beginBlock) {
                BeginBlock(beginBlock.replace(/['"]/g, ''))
                this.match = true
            }
            if (endBlock) {
                EndBlock(endBlock.replace(/['"]/g, ''))
                this.match = true
            }
            if (content) {
                Content(content)
                this.match = true
            }
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
            let d = depth
            BeginContent(name, d)
            EndContent(name, d)
            cntBlock = true
        }

        function BeginContent(name, d, decl) {
            var cnt = CNT(d)
            name = `${name}${d}`
            retStack.push(cnt)
            BlockHead(name)
            if (decl)
                body.push(`${LABEL('bcnt')} var ${cnt} = ''`)
        }

        function EndContent(name, d, append) {
            var cnt = retStack.pop()
            var ret = retStack.last()
            name = `${name}${d}`
            body = bodyStack.pop()
            BlockTail(name)
            if (block[name].prev)
                ret = block[name].prev
            if (append) {
                block[name].prev = cnt
                body.unshift(`${LABEL('ecnt')} ${ret} += ${cnt}`)
            }
            body = bodyStack.pop()
        }

        function FunctionCall(match, env, include, offset, str) {
            console.dir(arguments)
            var ret = retStack.last()
            var funccall = '/* error */'
            if (env) {
                funccall = `${FUN(0)}.env.apply(this, arguments)`
                body.push(`${LABEL('func')} ${ret} += ${funccall}`)
                this.match = true
            }
            if (include) {
                funccall = `${FUN(0)}.include(${include}).apply(this, arguments)`
                body.push(`${LABEL('func')} ${ret} += ${funccall}`)
                this.match = true
            }
            return match
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
    // Template.builtins.put = function(a) { return a ? '' + a : '' }
    // Template.builtins.escape = function() { return '' }
    Template.builtins.env = env
    Template.builtins.include = include
    return Template
}).call(this)
