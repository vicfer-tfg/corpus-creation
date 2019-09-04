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

const request = require('request');
const cheerio = require('cheerio');
const fs = require('fs');
require('date-utils');
var crypto = require('crypto');

var normalizeParams = (params) => {
  var json = new Object();

  json.site = params.site;
  json.auxiliar_site = params.auxiliar_site;
  json.collection = params.collection;
  json.url_list = params.url_list;
  json.default_conf = params.default_conf;
  json.default_selector_urls = params.default_selector_urls;
 
  if (!params.hasOwnProperty('configs')) {
    json.configs = [];
  } else {
    json.configs = params.configs;
  }

  if (!params.hasOwnProperty('remove')) {
    json.remove = [];
  } else {
    json.remove = params.remove;
  }

  //Para controlar las ediciones
  if (!params.hasOwnProperty('default_ediciones')) {
    json.default_ediciones = "";
  } else {
    json.default_ediciones = params.default_ediciones;
  }

  //Separador de la fecha
  if (!params.hasOwnProperty('default_date_separator')) {
    json.default_date_separator = "/";
  } else {
    json.default_date_separator = params.default_date_separator;
  }

  //Comprobar selector de la siguiente página
  if (!params.hasOwnProperty('next_page')) {
    json.next_page = "";
  } else {
    json.next_page = params.next_page;
  }

  //Maximo numero de paginas
  if (!params.hasOwnProperty('num_max_pages')) {
    json.num_max_pages = -1;
  } else {
    json.num_max_pages = params.num_max_pages;
  }
  
  return json
}

var getSelectorContent = ($, selector) => {
  var result = [];

  $(selector).each(function(i, elem) {

    result[i] = $(this).attr('href');

  });

  return result;
}

function list_urls (specific_config, date_ini, date_fin) {

  var params;
  //Normalizar los parámetros
    try {
    params = normalizeParams(specific_config);

  } catch (e) {
    return;

  }

  //Este if comprueba que si estamos buscando por categoría (no tenemos fecha)
  //solo tenga que hacer una vez el bucle de días
  if (params.url_list[0].indexOf("{fecha}") == -1){
  	date_fin.setTime(date_ini.getTime() + 1);
  	
  }

  var urls = [];

  for(var actual_day = date_ini; actual_day.isBefore(date_fin); actual_day.addDays(1)) {

    console.log(actual_day);
    //Consultar que fichero de configuración hemos de mirar
    var file_config = null;
    var selector_config = null;
    var date_separator_config = params.default_date_separator;
    var ediciones_config = params.default_ediciones;
    var pagination = false;

    if (params.configs.length>0) {
      
      //Recorremos todos los posibles ficheros de configuración
      for (var i in params.configs) {

        var each_time_config =  params.configs[i];
        var date_ini_time = new Date(each_time_config.start_date);
        var date_end_time = new Date(each_time_config.end_date);

        if (actual_day >= date_ini_time && actual_day <= date_end_time) {

          file_config = each_time_config.conf;
          selector_config = each_time_config.selector_urls;
          date_separator_config = each_time_config.date_separator;

          if (!each_time_config.hasOwnProperty('ediciones')) {
            ediciones_config = "";
          } else {
            ediciones_config = each_time_config.ediciones;
          }
          //Mirar si la web tiene paginación
          if (each_time_config.hasOwnProperty('pagination')) {
            pagination = each_time_config.pagination;
          
          } 
          break;
          
        }
      };

      if (file_config == null){
        file_config = params.default_conf;  
        selector_config = params.default_selector_urls;
        date_separator_config = params.default_date_separator;

        pagination = params.next_page
          
        }
    } else {
      file_config = params.default_conf;
      selector_config = params.default_selector_urls;
      date_separator_config = params.default_date_separator;

      pagination = params.next_page
    }

    //Modificar anyo, dia y mes
    var sep = date_separator_config;

    for (var each_url_list of params.url_list) {

      	var day_format = actual_day.toFormat('YYYY' + sep + 'MM' + sep + 'DD');

	    var new_url = each_url_list.replace(new RegExp('{fecha}', 'g'), day_format);

	    //Anteriormente esto solo lo hacía una vez pero ahora lo tengo que hacer una vez por cada edición en cada día.
	    edi = ediciones_config.split(',');

	    //Recorremos todas las ediciones que existan (Si solo hay una, solo ejecutaríamos el bucle una vez) 
	    for (var j = 0; j < edi.length; j++) {
	      var new_url_query = "";
	      //Si el vector no está vacío, significará que había ediciones. Es por ello, que debemos anadir a la url la edición
	      if (edi[j] != '') {
	        new_url_query = new_url + "/" + edi[j].trim() + "/";
	      } else {
	        new_url_query = new_url;
	      }

        var date_to_send = day_format.replace(new RegExp(sep, 'g'), '_');
    
	      var url_config = [new_url_query, file_config, selector_config, pagination, params, date_to_send];
	      urls.push(url_config)
	      
	    }
	}

  }
  return urls;
}

function create_correct_query(actual_href, params){

 	var query_url = '';
    actual_href = actual_href.trim();

    if (actual_href.startsWith('http') ) {
       query_url = actual_href;
      
    } else if (actual_href.indexOf
       (".com") > -1 || actual_href.indexOf
       (".es") > -1){
    	   query_url += params.auxiliar_site + actual_href;

    } else {
    	query_url += params.site + actual_href;

    }

    return query_url;

}

function save_information_each_query(query, config, selector, selector_next,
	params, actual_day, num_next, callback) {

  const options = {
        url: query,
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Linux i686; rv:64.0) Gecko/20100101' +
                      'Firefox/64.0'
        }, 
        json: true 
      };

  function request_callback(file_config_par, selector_config_par, selector_next,
  	config_collection, actual_day_par, num_max_pages, num_next_par) {

    return function(error, response, html) {
      //console.log(query)
      //Nos muestra el error de la pagina.
     /* if (error){
      	console.error("ha habido un error ", error)
      }

      if (!error && response.statusCode != 200) {
        console.error("Ha habido un error con código ", response.statusCode)
      }*/

      //Caso normal donde no ha habido error en el accceso a la página
      if (!error && response.statusCode == 200) {

      	//Mirar qu el html no este vacio
      	if (html) {

	        const $ = cheerio.load(html);

	        //Borrar todo lo que no nos interesa
	        for (var i in params.remove) {
	        	$(params.remove[i]).remove(); 
	        } 

	        var urls = getSelectorContent($, selector_config_par);
	        //Pasa urls a array

	        console.log(urls.length);

	        var hash = crypto.createHash('md5').update(query).digest('hex');

	        urls.forEach(function(actual_href) {          
	          //var query_url = 'http://localhost:3000/get_news?url=';
	        	
	          if (actual_href != undefined){
		          query_url = create_correct_query(actual_href, params)
		          //query_url += '&conf=' + file_config_par;
		          //console.log(query_url)

		          fs.appendFileSync('./urls_to_process/' + hash +"_" + config_collection
		          	+ "_" + actual_day_par, query_url + '\t'+ file_config_par + '\t' + config_collection +'\n');
		      }
	          
	        });
	        //Mirar si tiene siguiente
	        var next_query = getSelectorContent($, selector_next); 

	        if (next_query.length > 0 && (num_max_pages == -1 || num_next <num_max_pages)) {

	          //console.log("------------------------>Va a la siguiente")

	          if (next_query.length > 1) {
	          	console.warn("Hay mas de una URL siguiente");
	          } 
	          //Si tiene siguiente llamamos a la función de procesar la
	          // query con esta
	          if (!next_query[0].startsWith('http')) {
	          	next_query[0] = create_correct_query(next_query[0], params) 
	          }

	          save_information_each_query(next_query[0], config, selector,
	            selector_next, params, actual_day_par, num_next_par + 1, callback)

	        } else {
	        	callback();
	        }
	    } else{
	    	//LLamar a cllback si el html esta vacio
	    	callback();
	    }
      } else {
      	callback(error);
      }
    };
  }

  //console.log("------------------------------- \n", 
  //  params, "\n------------------------------- \n");

  request(options, request_callback(config, selector, selector_next, params.collection,
  	actual_day, params.num_max_pages, num_next)); 
}

if (!fs.existsSync('./urls_to_process')) { fs.mkdirSync('./urls_to_process'); }

//Leer parametros de entrada y el fichero
var each_config = JSON.parse(fs.readFileSync(process.argv[2]));
var fecha_ini = process.argv[3];
var fecha_fin = process.argv[4];

// crear una fecha con ellas
var date_ini = new Date(fecha_ini);
var date_fin = new Date(fecha_fin);
// la fecha de fin va incluida
date_fin.addDays(1);

//Cojemos todas las urls que tenemos que consultar
urls = list_urls(each_config, date_ini, date_fin);

function callback(i) {
	return function (error) {
		if (error) {
			console.error(error);
		} else if (i < urls.length - 1){
			i ++;
      console.log(i)
			save_information_each_query(urls[i][0], urls[i][1], urls[i][2],
				urls[i][3], urls[i][4], urls[i][5], 1, callback(i));
		}
	}	
} 
//LLamar la primera vez
callback(-1)();