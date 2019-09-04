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

const cheerio = require('cheerio');
const request = require('request');
const crypto = require('crypto');
const fs = require('fs');

const SITE_URL = 'https://www.ara.cat';
const CAT_URL = 'https://www.ara.cat/arxiu/[category]';

const CATEGORIES = ['politica/100/', 'internacional/300/', 
'societat/500/', 'economia/700/', 'cultura/600/', 'esports/800/',
'tecnologia/1400/', 'estils/10789/'];

var prev_urls = [];
var urls = [];
var next = '';

function writeURL(filename) {
  return function(url) {
    fs.appendFile(filename, `${url} ara_1 ara\n`, function(err) {
      if (err) throw err; 
    }); 
  }
}

if (!fs.existsSync('./urls_to_process')) { 
  fs.mkdirSync('./urls_to_process'); 
} 

function saveCategory(category, callback) {
  var url = CAT_URL.replace('[category]', category);
  console.log(`\n================================================`);
  console.log(`Procesando: ${url}`);
  console.log(`================================================`);

  request(url, 
    function(error, response, html) {
    $ = cheerio.load(html);
    next = $('a.btn-next').attr('href');

    if (next && !next.startsWith('http')) { 
      next = `${SITE_URL}${next.replace('page=2', 'page=[number]')}`;

    } else if (next) {
      next = `${next.replace('page=2', 'page=[number]')}`;

    }

    const reqCallback = (cpage) => {
      return function(error, response) {
        var json = JSON.parse(response.body);

        if (json.html != '') {
          $ = cheerio.load(`<html><body>${json.html}</body></html>`);

          console.log('\n-------------------------------------------------');
          console.log(next.replace('[number]', cpage));
          console.log('-------------------------------------------------');

          $('div.mt a.lnk').each(function(i, elem) {
            console.log(`${$(this).attr('href')}`);
            urls.push(`${$(this).attr('href')}`);
          }); 

          if (urls.length > 200) {
            // Copiamos todos el array a uno antiguo
            prev_urls = urls.slice();
            urls = [];
            var hash = crypto.createHash('md5').
              update(prev_urls[0]).digest('hex');

            if (fs.existsSync(`./urls_to_process/${hash}_ara`))
              fs.unlinkSync(`./urls_to_process/${hash}_ara`);

            prev_urls.forEach(writeURL(`./urls_to_process/${hash}_ara`));
          }

          if (cpage < 400) {
            request(next.replace('[number]', cpage + 1), 
              reqCallback(cpage + 1));

          } else {
            callback();
          }

        } else {
          callback();
        } 
      }
    };

    $('div.mt a.lnk').each(function(i, elem) {
      console.log(`${SITE_URL}${$(this).attr('href')}`);
      urls.push(`${SITE_URL}${$(this).attr('href')}`);
    }); 

    if (next) {
      request(next.replace('[number]', 2), reqCallback(2));

    } else {
      callback();
    }
  });
}

function catCallback(index) {
  return function() {
    if (urls.length > 0) {
      prev_urls = urls.slice();
      urls = [];
      var hash = crypto.createHash('md5').update(prev_urls[0]).digest('hex');

      if (fs.existsSync(`./urls_to_process/${hash}`))
        fs.unlinkSync(`./urls_to_process/${hash}`);

      prev_urls.forEach(writeURL(`./urls_to_process/${hash}`));
    }

    if (index < CATEGORIES.length) {
      saveCategory(CATEGORIES[index], catCallback(index + 1));
    }
  }
}

saveCategory(CATEGORIES[0], catCallback(1));
