
/* 
 * This file is part of the corpus-creation distribution 
 * (https://github.com/vicfer-tfg/corpus-creation).

 * Copyright (c) 2019 
 * Vicent Ahuir Esteve (viahes@eui.upv.es)
 * and 
 * Fernando Alcina Sanchis (feralsa5@inf.upv.es).
 * 
 * This program is free software: you can redistribute it and/or modify  
 * it under the terms of the GNU General Public License as published by  
 * the Free Software Foundation, version 3.
 *
 * This program is distributed in the hope that it will be useful, but 
 * WITHOUT ANY WARRANTY; without even the implied warranty of 
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU 
 * General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License 
 * along with this program. If not, see <http://www.gnu.org/licenses/>.
 */

const express = require('express');
const cheerio = require('cheerio');
const fs = require('fs');
const request = require('request');
const ProxyAgent = require('proxy-agent');
const iconv  = require('iconv-lite');
const charsetParser = require('charset-parser');
const CircularBuffer = require('circular-buffer');
require('date-utils').language("es");

const PORT = 3000;
const SOK = 
  "<p style='font-family: monospace; font-size: 18px;'>[OK] {ip}: {port}</p>";
const SKO = 
  "<p style='font-family: monospace; font-size: 18px;'>[KO] {ip}: {port}</p>";
const NREQ = 1000;
const request_with_proxy = !(process.argv[2] == 'false');

var proxies = [];
var checking_proxy = [];
var proxies_ready = false;
var current_proxy = 0;
var request_count = 0;
var selectors = {};

var responses_cache = new CircularBuffer(10); 

//process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0

// Dado un array a, mezcla el orden de los elementos
function shuffle(a) {
  var j, x, i;
  for (i = a.length - 1; i > 0; i--) {
      j = Math.floor(Math.random() * (i + 1));
      x = a[i];
      a[i] = a[j];
      a[j] = x;
  }
  return a;
}

// Rellenar con 0's a la izquierda
function leftPad(number, targetLength) {
  var output = number + '';
  while (output.length < targetLength) {
    output = '0' + output;
  }

  return output;
}

// Busca el siguiente proxy bueno
function nextProxy() {
  var count = 0;
  current_proxy = (current_proxy + 1) % proxies.length;

  // Comprobamos que el proxy actual esté operativo
  while (!proxies[current_proxy].ok && count < proxies.length) {
    current_proxy = (current_proxy + 1) % proxies.length;
    ++count;
  }

  // Si hemos llegado a dar la vuelta a todos los proxies y no hay
  // ninguno bueno, quiere decir que no podemos atender más peticiones
  if (count == proxies.length) {
    proxies_ready = false;
    console.error("All proxies down");
  }

  request_count = 0;
}
// Sirve para estandarizar cualquier parámetro de la configuración de contenido
function normalizeProperty(property, attr, list, list_join) {
  var result = property;

  // Si el valor de la propiedad es solo un string, quiere decir que
  // solo se le pasa el selector. Por tanto el resto de atributos llevan el
  // valor por defecto
  if (typeof property === 'string' || Array.isArray(property)) {
    result = new Object();

    if (typeof property === 'string') {
      result.selectors = [property];

    } else {
      result.selectors = property;
    }

    result.attr = attr;
    result.list = list;
    result.list_join = list_join; 
    result.list_take = -1;

  } else {
    if (!result.hasOwnProperty('selectors')) {
      result.selectors = [result.selector];
    }

    // Si algún atributo no está especificador, podemos el valor por defecto
    if (!result.hasOwnProperty('attr')) {
      result.attr = attr;
    } 

    if (!result.hasOwnProperty('list')) {
      result.list = list;
    }

    if (!result.hasOwnProperty('list-join')) {
      result.list_join = list_join;

    } else {
      result.list_join = result["list-join"];
    }

    if (!result.hasOwnProperty('list-take')) {
      result.list_take = -1;

    } else {
      result.list_take = result["list-take"];
    }
  }

  if (property.hasOwnProperty('remove-at-begin')) {
    result.remove_at_begin = result['remove-at-begin'];

  } else {
    result.remove_at_begin = [];
  }

  if (property.hasOwnProperty('remove-at-end')) {
    result.remove_at_end = result['remove-at-end']; 

  } else {
    result.remove_at_end = [];
  }

  return result;
}

// Sirve para estandarizar los parámetros de la configuración de contenido
function normalizeParams(params) {
  var json = new Object();

  json.content = normalizeProperty(params.content, '', false, "");
  json.title = normalizeProperty(params.title, '', false, "");
  json.keywords = normalizeProperty(params.keywords, 'content', false, "");
  json.description = normalizeProperty(params.description, 'content', 
    false, "");

  {
  var pd = normalizeProperty(params.publi_date, 'content', false, "");

  if (!pd.hasOwnProperty('formats') && pd.hasOwnProperty('format')) {
    pd.formats = [pd.format];

  } else if (!pd.hasOwnProperty('formats') && !pd.hasOwnProperty('format')) {
    pd.formats = ["dd-mm-yyyy"];
  }

  if (!pd.hasOwnProperty('separator')) pd.separator = "/";
  if (!pd.hasOwnProperty('months')) pd.months = [];

  json.publi_date = pd;
  }

  json.category = normalizeProperty(params.category, 'content', false, "");
  json.author = normalizeProperty(params.author, 'content', false, "");
  json.url = normalizeProperty(params.url, 'content', false, "");
  json.twitter_title = 
    normalizeProperty(params.twitter_title, 'content', false, "");
  json.twitter_descrip = 
    normalizeProperty(params.twitter_descrip, 'content', false, "");
  json.twitter_image = 
    normalizeProperty(params.twitter_image, 'content', false, "");
  json.language = params.language;

  if (!params.hasOwnProperty('remove')) {
    json.remove = [];
  } else {
    json.remove = params.remove;
  }

  if (!params.hasOwnProperty('no_content')) {
    json.no_content = [];
  } else {
    json.no_content = params.no_content;
  }

  return json
}

// Con el dom del html $ y la configuración de contenido, devolvemos el valor
// en texto
function getSelectorContent($, sc) {
  // El resultado es un array que al final uniremos con la cadena de unión
  // específicada en la configuración
  const result = [];

  for (selector of sc.selectors) {
    $(selector).each(function(i, elem) {
      var val = '';
      // Si no es el atributo contenido, quiere decir que es el texto dentro
      // del
      // tag en cuestión
      if (sc.attr.length == 0) {
        val = $(this).text();

      } else {
        val = $(this).attr(sc.attr);

        if ( !val || typeof val != 'string' ) {
          val = '';
        }
      }

      // Borramos toda aquella cadena que esté al principio de la cadena
      for (var str of sc.remove_at_begin) {
        if (val.toLowerCase().startsWith(str.toLowerCase())) 
          val = val.substring(str.length);
      }

      // Borramos toda aquella cadena que esté al final de la cadena
      for (var str of sc.remove_at_end) {
        if (val.toLowerCase().endsWith(str.toLowerCase())) 
          val = val.substring(0, val.length - str.length);
      }

      if (!sc.list || (sc.list && (sc.list_take == -1 || sc.list_take == i))) {
        result.push(val.trim());
      }

      // En el caso de que el usuario no marque que la propiedad es una lista,
      // se entiende que éste espera que el selector devuelva un solo elemento.
      // Por tanto se muestra un aviso, para que sea consciente de que devuelve
      // más de un elemento.
      if (!sc.list && result.length == 2) {
        console.warn(`The selector/s '${sc.selector}' is geting more than ` +
          "one element and it's not a list");
      }
    });
  }

  // Devolvemos la cadena formada por el array unido con la cadena de unión
  return result.join(sc.list_join).trim();
}

// Devuelve 
function normalizeDate(publi_date, params) {
  const pdate = publi_date.toLowerCase();
  var cpos = 0;
  var day = false;
  var month = false;
  var year = false;
  var d = null;
  var pformat = 0;

  while (d == null && pformat < params.formats.length) {
    const fields = params.formats[pformat].split("-");
    cpos = 0;
    day = month = year = false;

    try {
      if (fields.length >= 3) {
        for (field of fields) {
          switch (field) {
            case 'dd':
              var d = pdate.substring(cpos, cpos + 2);
              // Comprobamos si son dos dígitos o uno
              if (isNaN(parseInt(d[1]))) d = d[0];

              day = parseInt(d);

              cpos += d.length + params.separator.length;
              day_ok = true;

              break

            case 'mm':
              var m = pdate.substring(cpos, cpos + 2);
              // Comprobamos si son dos dígitos o uno
              if (isNaN(parseInt(m[1]))) m = m[0];

              month = parseInt(m); 

              cpos += m.length + params.separator.length;
              month_ok = true;

              break;

            case 'month':
              var month = 0;
              var months = params.months;

              while (month < months.length &&
                pdate.substring(cpos).indexOf(months[month]) != 0) {
                ++month;
              }

              if (month < months.length) {
                cpos += months[month].length + params.separator.length;

                // Como comenzamos de 0, incrementamos en 1
                ++month;

              } else {
                month = false;
              }

              break;

            case 'yyyy':
              year = parseInt(pdate.substring(cpos, cpos + 4)); 

              cpos += 4 + params.separator.length;
              year_ok = true;

              break;

            case 'w':
              if (pdate.substring(cpos).indexOf(' ') > 0) 
                cpos += pdate.substring(cpos).indexOf(' ') - 1; 

              break;

            default:
              cpos += field.length + params.separator.length;
          }
        } 
      } 
    } catch (e) {
      console.warn(`Error parsing ${pdate}:\n${e}`);
    }

    d = new Date(year, month, day);

    if (!day || !month || !year || isNaN(d.getTime())) {
      d = null;
    }

    ++pformat;
  }

  if (d == null) {
    console.warn(`Publication date could not set with '${
      pdate}' and formats '${params.formats}'`);

    return null;

  } else {
    return `${leftPad(day,2)}-${leftPad(month,2)}-${leftPad(year,4)}`;
  }
}

// A partir del html en plano, el método devuelve un json con todos los
// atributos que se han marcado como de interés.
function getContent(params, url, response, binary) {
  // parse charset
  const enc = charsetParser(response.headers['content-type'], 
    binary, 'iso-8859-15');
  // decode binary with charset
  const html = iconv.decode(Buffer.from(binary, 'binary'), enc);

  const $ = cheerio.load(html);

  // Si alguno de les selectores está en la página, la página se 
  // considera sin contenido
  var json = new Object();
  json.content = '';
  json.url = url;

  for (var selector of params.no_content) {
    if ($(selector).length > 0) return json;
  }

  // Limpiamos el dom, de aquellos elementos que se han encontrado que
  // molestaban para sacar correctamente la información esencial
  for (var selector of params.remove) {
    $(selector).remove(); 
  } 

  // El cuerpo de la noticia
  var content = getSelectorContent($, params.content);
  
  // El título de la noticia
  var title = getSelectorContent($, params.title);
  
  // Las palabras clave
  var keywords = getSelectorContent($, params.keywords);

  // La descripción de la noticia
  var description = getSelectorContent($, params.description);

  // Fecha de publicación
  var publi_date = getSelectorContent($, params.publi_date);
  publi_date = normalizeDate(publi_date, params.publi_date);

  // Categorias
  var category = getSelectorContent($, params.category);

  // Autor
  var author = getSelectorContent($, params.author);

  // URL
  //var url = getSelectorContent($, params.url);

  // Título para Twitter
  var twitter_title = getSelectorContent($, params.twitter_title);

  // Descripción para Twitter
  var twitter_descrip = getSelectorContent($, params.twitter_descrip);

  // Imagen para Twitter
  var twitter_image = getSelectorContent($, params.twitter_image);

  // Idioma de la noticia
  var language = params.language;

  json.content = content;
  json.title = title;
  json.keywords = keywords;
  json.description = description;
  json.publi_date = publi_date;
  json.category = category;
  json.author = author;
  json.twitter_title = twitter_title;
  json.twitter_descrip = twitter_descrip;
  json.twitter_image = twitter_image;
  json.language = language;

  return json;
}

// Comprueba si el proxy funciona correctamente
// En caso contrario lo marca como no funcional
function checkProxy(num_proxy, callback) {
  const req_callback = (num_proxy, callback) => {
    return function (error, response, body) {
      proxies[num_proxy].ok = error == null;

      if (callback)
        callback(num_proxy);
    };
  };

  const ip = proxies[num_proxy].ip; 
  const port = proxies[num_proxy].port; 
  const type = proxies[num_proxy].type.toLowerCase(); 
  const proxyUri = `${type}://${ip}:${port}`;

  const req_options = {
    url: 'http://www.upv.es',
    agent: new ProxyAgent(proxyUri),
    timeout: 10000,
    encoding: 'binary',
    headers: {
      'User-Agent': 
          'Mozilla/5.0 (X11; Linux i686; rv:64.0) Gecko/20100101' + 
          ' Firefox/64.0'
    },  
  };

  request.get(req_options, req_callback(num_proxy, callback));
}

// Callback para tratar las peticiones de procesar noticia a json
function requestGetNewsHandler(req, resp) {
  if (request_with_proxy && !proxies[current_proxy].ok) {
    nextProxy();
  }

  if (request_with_proxy && !proxies_ready) { 
      resp.status(524).send('KO');
    return
  }

  const url = req.query.url;

  // Si ya tenemos la configuración en cache, la ponemos directamente
  if (false && selectors[req.query.conf]) {
    params = selectors[req.query.conf];

  } else {
    const conf = `selectors/${req.query.conf}.conf`;

    if (!fs.existsSync(conf)) { 
        resp.status(521).send(`Conf '${conf}' not found`);
      return
    }

    //Leer el fichero de configuracion
    var params;

    try {
      params = normalizeParams(JSON.parse(fs.readFileSync(conf, 'utf8')));
      selectors[req.query.conf] = params;

    } catch (e) {
        resp.status(522).send('Incorrect conf: \n' + e);
        return;
    }
  }

  // Opciones de la request
  var options = {
    url: url,
    encoding: 'binary',
    headers: {
    'User-Agent': 
      'Mozilla/5.0 (X11; Linux i686; rv:64.0) Gecko/20100101 Firefox/64.0'
    }, 
    json: true 
  }; 

  // Proxy usado actualmente
  if (request_with_proxy) {
    const ip = proxies[current_proxy].ip; 
    const port = proxies[current_proxy].port; 
    const type = proxies[current_proxy].type.toLowerCase(); 
    const proxyUri = `${type}://${ip}:${port}`;

    options.agent = new ProxyAgent(proxyUri);
    console.log(`[${req.query.conf}] ${url} => ${proxyUri}`);

  } else {
    console.log(`[${req.query.conf}] ${url} => public ip`);
  }

  const callback = (num_proxy, params, url) => { 
    return function(error, response, html) {
      if (!error && response.statusCode == 200) {
        if (responses_cache.size() == 0 || responses_cache.get(0).url != url) {
          responses_cache.enq({
            "url" : url,
            "error" : error,
            "response" : response,
            "html" : html
          });
        }

        if(response != null) resp.json(getContent(params, url, response, html));

      } else if (error) {
          if (!error.hasOwnProperty('cert')) {
            resp.status(523).send(error);
          } else {
            // Si entra por aquí, es que ha sido un error de certificado
            // No es un error del server
            resp.status(526).send(error);
          }

          // Si no se está comprobando ya el proxy, miramos si el error
          // es puntual o si el proxy está "caido"
          if (request_with_proxy && !checking_proxy[num_proxy]) {
            nextProxy();
          checking_proxy[num_proxy] = true;

            checkProxy(num_proxy, 
              function(num_proxy) {
                checking_proxy[num_proxy] = false;
              });
          }

      } else {
        resp.status(response.statusCode).send(response);
      }
    };
  };

  ++request_count;

  // Si el número de peticiones es múltiplo de NREQ, cambiamos de proxy
  if (request_with_proxy && request_count % NREQ == 0) {
    nextProxy();  
  }

  var callback_request = callback(current_proxy, params, url);
  var cache = null;
  var count = 0;

  while (!cache && count < responses_cache.size()) {
    if (responses_cache.get(count).url == url) { 
      cache = responses_cache.get(count); 

    } else { 
      ++count;
    }
  }

  if (cache == null) {
    request(options, callback_request);

  } else {
    callback_request(cache.error, cache.response, cache.html);
  }
}

// Atiende la petición de comprobar los proxies
function requestCheckProxiesHandler(req, resp) {
  const callback = (num_proxy) => {
    if (num_proxy == proxies.length - 1) {
      proxies_ready = true;
      resp.status(200).json(proxies);

    } else {
      checkProxy(num_proxy + 1, callback);
    }
  };
  
  proxies_ready = false;
  checkProxy(0, callback);
}

function requestStatusProxiesHandler(req, resp) {
  resp.status(200).json(proxies);
}

// Leemos el fichero de proxies
if (request_with_proxy) {
  fs.readFile('proxies.list',
    function(err, data) { 
      if (err) throw err;
      var array = data.toString('utf8').split("\n");

      for(i in array) {
        var val = array[i].trim();

        if (val.length == 0) continue;
        if (array[i].startsWith('#')) continue;

        proxies[proxies.length] = JSON.parse(val);
        proxies[proxies.length - 1].ok = true;
      } 

    const callback = (num_proxy) => {
      if (num_proxy == proxies.length - 1) {
        proxies_ready = true;
        console.log(proxies);

      } else {
        checkProxy(num_proxy + 1, callback);
      }
    };
    
    // Si hay proxies, comenzamos a comprobar si funcionan  
    // Si no hay, nos salimos. Siempre operamos con proxies
    if (proxies.length > 0) {
      checkProxy(0, callback);

    } else {
      console.error('No proxies available!');
      process.exit(-1);
    }
      //shuffle(proxies)
  }
  ); 
}

const server = express();

server.get('/get_news', requestGetNewsHandler);

if (request_with_proxy) {
  server.get('/check_proxies', requestCheckProxiesHandler);
  server.get('/status_proxies', requestStatusProxiesHandler);
}

server.listen(PORT, (err) => {
  if (err) {
    return console.log('something bad happened', err);
  }

  console.log(`server is listening on ${PORT}`);
});
