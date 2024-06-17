{
    function listToSexpr(elements) {
        if (elements.length === 0) {
            return {type: "atom", value: "nil"}
        } else {
            return {type: "pair", left: elements[0], right: listToSexpr(elements.slice(1))}
        }
    }

    function listWithSentinelToSexpr(elements, sentinel) {
        if (elements.length === 1) {
            return {type: "pair", left: elements[0], right: sentinel}
        } else {
            return {type: "pair", left: elements[0], right: listWithSentinelToSexpr(elements.slice(1), sentinel)}
        }
    }
}

thing = fnk+ / sexpr
sexpr = _ atom:(literal / variable) _ {return atom}
      / _ "(" left:sexpr "." right:sexpr ")" _ { return {type: "pair", left: left, right: right } }
      / _ "(" list:sexpr|.., _| _ "." _ sentinel:sexpr _  ")" _ { return listWithSentinelToSexpr(list, sentinel) }
      / _ "(" list:sexpr|.., _| ")" _ { return listToSexpr(list) }

fnk   = _ name:sexpr _ "{" _ cases:match_case+ _ "}" _ { return {name, cases}; }

match_case = _ pattern:sexpr _ "->" _ fn_name_template:sexpr _ ":" _ template:sexpr _ next:(
        ";" { return "return"; }
        / "{" _ items:match_case+ _ "}" { return items; }
    ) { return {pattern, fn_name_template, template, next}; }

literal    = "#" value:word { return {type: "atom", value} }
variable   = (! ("." / "#")) value:word { return {type: "variable", value} }
word       = chars: (!delimiter @.)+ { return chars.join("") }
space      = " " / [\n\r\t]
comment    = "//" (![\n\r] .)*

paren      = "(" / ")"
delimiter  = paren / space / "{" / "}" / ":" / ";"

_ = (space / comment)*
