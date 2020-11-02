const path = require('path');
const fs = require('fs')
const lineReader = require('line-reader');
const puppeteer = require('puppeteer');
const uniq = require('lodash.uniq')
const deburr = require('lodash.deburr')
const axios = require('axios');

// file with words
const textFile = path.resolve(__dirname,process.argv[2])

// lets parse the lines from the file
const lines = []
lineReader.eachLine(textFile, function(line) {
  lines.push(line)
}, function (err) {
  if (err) throw err;
  // if all is ok, let's start the puppeteer
  init()
});


/**
 * Main procedure
 */
async function init() {
  console.log(`Checking ${lines.length} words`);

  // we will start the puppeteer in headless mode (without GUI)
  const browser = await puppeteer.launch({headless: true});
  
  // open first tab for punctutation checking
  let punctuation = await getPunctuation(browser, lines)
  console.log(`Got punctuation for ${punctuation.length} words`);
  
  // use remote api to get lema of the words
  let lema = await getLema(punctuation)
  console.log(`Got lema for ${lema.length} words`);

  // open another tab for declension calculation
  const declension = await getDeclension(browser, lema)
  console.log(`Got declension result`);
  
  // close the puppeteer
  browser.close();

  writeToFile(declension)
} // init


/**
 * Method which will open https://lindat.mff.cuni.cz/services/korektor/ web
 * and find correct punctuation for each line
 * 
 * @param {Array} lines 
 * @returns {Array}
 */
async function getPunctuation(browser, lines) {
  const page = await browser.newPage()
  await page.goto("https://lindat.mff.cuni.cz/services/korektor/");
  await page.click("#tasks > label:nth-child(2)");
  const result = []
  for await(let line of lines) {
    await page.$eval("#input", (el, line)=>{el.value = line}, line)
    await page.click("#submit");

    const response = await page.waitForResponse(response => response.url() === 'https://lindat.mff.cuni.cz/services/korektor/api/suggestions');
    const json = await response.json();
    result.push(json.result[0][0])
  }
  return result
} // getPunctuation


/**
 * Method which will get lema for words in czech language
 * @param {Array} lines 
 * @returns {Array}
 */
async function getLema(lines){
  const result = []
  for await (const line of lines) {
    const uri = encodeURI('https://nlp.fi.muni.cz/languageservices/service.py?call=tagger&lang=cs&output=json&text='+line)
    const response = await axios.get(uri);
    result.push(response.data.vertical[1][1])
  }
  return result
} // getLema


/**
 * Method which will get declension for full object
 * @param {Array} lines [žena, ulica]
 * @returns {object} - returns deburred words with declension {zena: {zena...}, ulica: {ulica...}}
 */
async function getDeclension(browser, lines) {
  const result = {}

  const page = await browser.newPage();
  await page.goto("http://aztekium.pl/sklonovanie.py");
  await page.click("body > center > form > table:nth-child(3) > tbody > tr > td:nth-child(2) > table:nth-child(2) > tbody > tr:nth-child(1) > td:nth-child(4) > a > img")
  
  for await(let line of lines) {
    await page.type('#in', line);
    await page.keyboard.press('Enter');
    await page.waitForNavigation();
    const results = await page.$$eval('td[bgcolor="#eeeeee"]', el => {
      return el.map(data => data.textContent.trim());
    });

    let unique = []
    // some words may return result in format  "ulica/ulice/ulici", 
    // we will flat the result to a single unique array 
    results.forEach(res=>{
      let temp = res.split('/')
      temp.forEach(t=>{
        let cleared = deburr(t)
        if(cleared) {
          unique.push(cleared)
        }
      })
    })
    // all keys and values are deburred 
    let key = deburr(line.charAt(0));
    if(!result[key]) {
      result[key] = {}
    }
    result[key][deburr(line)] = uniq(unique)
  }
  return result
} // getDeclension



/**
 * Writes words to a separate file named by the first letter of the word beeing processed
 * @param {object} storage 
 */
function writeToFile(storage) {
  const keys = Object.keys(storage)
  let counter = 0
  keys.forEach(k=>{
    let item = storage[k]
    let res = ''
    for(let i in item) {
      counter++
      res += `${i}: ${item[i].join(', ')} \n`
    }
    fs.writeFileSync(path.resolve(__dirname, 'res', k+'.txt'), res);
  })
  return console.log(`Stored ${counter} words`);
} // writeToFolder
