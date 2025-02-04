/*---------------------------------------------------------------------------
  Copyright 2012-2021, Microsoft Research, Daan Leijen.

  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the LICENSE file at the root of this distribution.
---------------------------------------------------------------------------*/

var $regexCache = {}

function $regexCreate( s, ignoreCase, multiLine )
{
  // we always use "g" flag.
  // to re-use safely, we always need to explicitly set 'lastIndex' on each use!
  var flags = (ignoreCase!==0 ? "i" : "") + (multiLine!==0 ? "m" : "");
  var key = s+flags;
  if ($regexCache[key]) return $regexCache[key];
  var regx = null;
  try {
    regx = new RegExp( s, "gd" + flags );
  }
  catch(exn) {
    if (exn instanceof SyntaxError && exn.message != null && exn.message.includes("Invalid flags")) {
      regx = new RegExp( s, "g" + flags );
    }
    else {
      throw exn;
    }
  }
  var rx = { regex: regx, flags: flags };
  $regexCache[key] = rx;
  return rx
}



// Execute
function $regexExecEx( r,  s, start )
{
  r.regex.lastIndex = start;
  const match = r.regex.exec(s);
  if (!match) {
    return { match: match, slices: $std_core.Nil }; // Matched(-1,0,"",[""]);
  }
  else if (match.indices instanceof Array) {
    const indices = match.indices;
    var res = $std_core.Nil;
    for( var i = indices.length - 1; i >= 0; i--) {
      var rng = indices[i];
      var sslice;
      if (rng == null) {
        sslice = $std_core.invalid;
      }
      else {
        const idx = rng[0];
        const len = rng[1] - idx;
        sslice = $std_core._new_sslice(s,idx,len);
      }
      res = $std_core.Cons( sslice, res);
    }
    return { match: match, slices: res };
  }
  else {
    // older JS, no 'd' flag for indices; emulate by creating slices directly on the match strings
    const next = r.regex.lastIndex;
    var res = $std_core.Nil;
    for( var i = match.length - 1; i > 0; i--) {
      const sub = match[i];
      var sslice;
      if (sub == null) {
        sslice = $std_core.invalid;
      }
      else {
        sslice = $std_core._new_sslice(sub,0,sub.length);
      }      
      res = $std_core.Cons( sslice, res);
    }
    res = $std_core.Cons( $std_core._new_sslice(s,match.index,next - match.index), res);
    return { match: match, slices: res };
  }
}

function $regexExec( r,  s, start )
{
  return $regexExecEx(r,s,start).slices;
}

function $regexExecAll( r,  s, start, atmost )
{
  if (atmost < 0) { atmost = Number.MAX_SAFE_INTEGER; }
  var result = [];
  while (atmost > 0) {
    var res = $regexExecEx(r,s,start);
    if (res.match == null) break;
    var pre = $std_core._new_sslice( s, start, res.match.index - start );
    result.push( $std_core.Cons(pre,$std_core.Nil) ); // singleton pre list
    result.push( res.slices );
    // avoid loop on zero-length match
    atmost--;
    if (r.regex.lastIndex <= start) {
      start++;
    }
    else {
      start = r.regex.lastIndex;
    }
  }
  // and push the post string
  var post = $std_core._new_sslice( s, start, s.length - start );
  result.push( $std_core.Cons(post,$std_core.Nil) ); // singleton post list
  return $std_core._vlist(result,null);
}


/*

function $regexCreateAlt( regexs, ignoreCase, multiLine ) {
  var offsets = [];
  var alts = []
  var current = 1;
  var prefix = $findPrefix(regexs);
  var prefixCount = $countGroups(prefix);
  if (prefix !== "") {
    // TODO: fix prefix that has a halfway capture group
    regexs = regexs.map( function(r) { return r.substr(prefix.length); } );
    current += prefixCount;
  }
  regexs.map( function(regex) {
    offsets.push(current)
    regex = regex.replace(/\\(\d)/g, function(match,digit) {
      var d = parseInt(digit);
      return (d <= prefixCount ? match : ("\\" + (d + current - prefixCount)))
    })
    current += (1 + $countGroups(regex));
    alts.push( "(" + regex + ")" );
  })
  offsets.push(current) // final

  var alt = $regexCreate( prefix + "(?:" + alts.join("|") + ")", ignoreCase, multiLine );
  alt.offsets = offsets;
  return alt;
}

// cache a non-global version too
function $regex_nong( r ) {
  if (r.regexng) return r.regexng;
  r.regexng = new RegExp( r.regex.source, r.flags )
  return r.regexng;
}

function $countGroups( regex ) {  // (string) -> int
  // (?x)(?<!(\\|(?!\\)\(\?))\((?!\?)
  var parens = regex.replace(/[^\\\[(]+|\\[\s\S]?|\(\?|\[(?:[^\\\]]|\\.)*\]/g, "");
  return parens.length
}

function $findPrefix( xs ) { // ([string]) -> string
  if (!xs) return "";
  if (xs.length == 0) return "";
  if (xs.length == 1) return xs[0];

  var prefix = "";
  var minlen = xs[0].length;
  xs.map( function(s) { if (s.length < minlen) minlen = s.length; });
  for( var i = 0; i < minlen; i++) {
    var c = xs[0][i];
    for (var j = 1; j < xs.length; j++ ) {
      if (xs[j][i] !== c) {
        return prefix;
      }
    }
    prefix = prefix + c;
  }
  return prefix;
}

function $regexGroups( r, match ) {
  if (!r.offsets || r.offsets.length <= 1) return match;

  var groups = [match[0]]
  groups.alternative = -1;
  for( var i = 0; i < r.offsets.length-1; i++ ) {
    if (match[r.offsets[i]] != null) {
      groups.alternative = i;
      // first push prefix groups
      var j = 1;
      while( j < r.offsets[0] ) {
        groups.push(match[j]);
        j++;
      }
      // then the groups of the alternative we matched
      var j = r.offsets[i] + 1;
      while( j < r.offsets[i+1] ) {
        groups.push(match[j])
        j++;
      }
      break;
    }
  }
  return groups;
}

function $regexSearch( r, s, start ) {
  var res = $regexExec(r,s,start);
  return res.index;
}

function $regexSplit( r, s, n, start ) {
  r.regex.lastIndex = start;
  return (n <= 0 ? s.split( r.regex ) : s.split( r.regex, n ));
}

function $regexReplaceFun( r,  s, repl, all, start)
{
  var regex = (all === 0 ? $regex_nong(r) : r.regex);
  //if (!s || !regex.test(s)) return s

  regex.lastIndex = start;
  return s.replace( regex, function() {
    if (arguments.length < 3) return ""; // should never happen!
    var index = arguments[arguments.length-2];
    var match = [];
    for(var i = 0; i < arguments.length-2; i++) {
      match[i] = arguments[i];
    }
    var matched = match[0] ? match[0] : ""
    var next = index + matched.length;
    // if (next<=index) next = index+1;
    var groups = (r.offsets ? $regexGroups(r,match) : match);
    var slice = $std_core._new_sslice(s,index,next - index);    
    return repl( Matched( slice, matched, Groups(groups) ) );
  });
}

function $regexReplace( r, s, repl, all, start )
{
  var regex = (all === 0 ? $regex_nong(r) : r.regex);

  //if (!s || !regex.test(s)) return s
  regex.lastIndex = start;
  return s.replace( regex, repl ); // TODO: wrong for alt regex's
}

*/