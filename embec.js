/* embec.js */

var Template = (function () {
    const DEBUG_COMPILE = true

    var tags = {
        interpolate: /<%=([\s\S]+?)%>/g,
        comment: /<%#([\s\S]+?)%>/g,
        escape: /<%-([\s\S]+?)%>/g,
        evaluate: /<%([\s\S]+?)%>/g,
    }
    var matcher = RegExp([
        tags.interpolate.source,
        tags.comment.source,
        tags.escape.source,
        tags.evaluate.source,
    ].join('|') + '|$', 'g')

    var specialForms = {
        env: /(env)\([\s\S]*\)/g,
        include: /include\(([\s\S]+?)\)/g,
        block: /block\(([\s\S]+?)\)/g,
        end: /end\(([\s\S]+?)\)/g,
    }
    var specialMatcher = RegExp([
        specialForms.env.source,
        specialForms.include.source,
        specialForms.block.source,
        specialForms.end.source,
    ].join('|') + '|$', 'g')

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

    function beginBlock(blockname, bodies) {
        let body = bodies[0]
        if (body === undefined)
            return ''
        let _body = '', idx = 0, prev = 0
        let beginMatcher = RegExp(
            `<%\\s*block\\s*\\(\\s*${blockname}\\s*\\)\\s*%>`)
        let endMatcher = RegExp(
            `<%\\s*end\\s*\\(\\s*${blockname}\\s*\\)\\s*%>`)

        let beginMatch = body.match(beginMatcher)
        let begin = beginMatch.index + beginMatch[0].length
        let endMatch = body.match(endMatcher)
        let end = endMatch.index

        let matcher = RegExp('(<%\\s*block\s*\\([\\s\\S]+?\\)\\s*%>)' + '|' +
            '(<%\\s*end\\s*\\([\s\S]+?\\)\\s*%>)|$', 'g')
        body.replace(matcher, function (m, b, e, o) {
            idx += prev
            _body += body.slice(idx, o)
            idx = o + m.length
            prev = o + m.length
            return m
        })

        return {
            block: body.substring(begin, end),
            body: _body
        }
    }

    function endBlock(block, depth) {
        return '\n__$r' + (depth - 1) + ' += __$r' + depth
    }

    function compile(body, depth) {
        let idx = 0
        let _body = ""
        let bodies = []
        let _cont = ""

        if (body === undefined)
            return _body

        if (Array.isArray(body)) {
            bodies = body
            body = bodies[0]
        }

        if (depth === undefined)
            depth = 0

        // __$r# return string
        // __$s# scope
        // __$f# functions in scope
        function __return() { return '__$r' + depth }
        function __scope() { return '__$s' + depth }
        function __func() { return '__$f' + depth }

        _body += `let ${__return()} = ''` + "\n"
        _body += `let ${__scope()} = arguments[0]` + "\n"
        _body += `let ${__func()} = {}` + "\n"

        for (let bname of Object.keys(Template.builtins))
            _body += `\n${__func()}.${bname} = Template.builtins.${bname}`

        _body += "\n"
        body.replace(matcher, function (m, i, c, _e, e, o) {
            _body += "\n/* ｃｏｐｙ */\t\t"
            _body += `${__return()} += '`
            _body += body.slice(idx, o).replace(escapeRegExp, escapeChar)
            _body += "'"

            idx = o + m.length

            if (e) {
                // replace special forms
                let special = e
                let _special = ""
                let specialIdx = 0
                let matchedSpecial = false
                special.replace(specialMatcher, function(m, e, i, bb, be, o) {
                    if (i) {
                        _special += `;${__return()} += `
                        _special += `${__func()}.include(${i}).apply(this, arguments)`
                        matchedSpecial = true
                    } else if (e) {
                        _special += `;${__return()} += `
                        _special += `${__func()}.env.apply(this, arguments)`
                        matchedSpecial = true
                    } else if (bb) {
                        let _block = beginBlock(bb, bodies.slice(1))
                        _special += "{\n"
                        _special += compile(_block.block, depth + 1)
                        _cont += compile(_block.body, depth + 1)
                        matchedSpecial = true
                    } else if (be) {
                        _special += endBlock(be, depth + 1)
                        _special += "\n}\n"
                        matchedSpecial = true
                    }
                    specialIdx = o + m.length
                    return m
                })

                if (matchedSpecial) {
                    _body += "\n/* ｓｐｅｃ */\t\t"
                    _body += _special
                } else {
                    if (e.includes('$content')) {
                        _body += "\n/* ｃｏｎｔ */\t\t {\n"
                        _body += _cont
                        _body += endBlock('$content', depth + 1)
                        _body += "\n}\n"
                    } else {
                        _body += "\n/* ｅｖａｌ */\t\t"
                        _body += scopeReplacer(e, __scope())
                    }
                }
            } else if (i) {
                _body += "\n/* ｉｎｔｐ */\t\t"
                _body += `${__return()} += '' + ${__func()}.put(${scopeReplacer(i, __scope())})`
            } else if (c) {
                _body += "\n/* ｃｏｍｍ */\t\t"
            } else if (_e) {
                _body += "\n/* ｅｓｃｐ */\t\t"
                _body += "__$r0 += '' + __$f0.escape(" + _e + ")"
            }

            return m
        })
        _body += "\n"
        if (!depth)
            _body += "\nreturn __$r0\n"

        return _body
    }

    var anonCount = 0
    class Template extends Function {
        constructor(name, body) {
            if (body === undefined) {
                body = name;
                name = 'anonymous' + anonCount++
            }
            let _body = compile(body)
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
