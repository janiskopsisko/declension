const resolve = require('path').resolve;
const lineReader = require('line-reader');
const puppeteer = require('puppeteer');
const uniq = require('lodash.uniq')
const deburr = require('lodash.deburr')
const axios = require('axios');
const fs = require('fs-extra')
const inquirer = require('inquirer')


const chalk = require('chalk');
const clear = require('clear');
const figlet = require('figlet');

clear();

console.log(
  chalk.yellow(
    figlet.textSync('Mosy', {
      horizontalLayout: 'full'
    })
  )
);


function log(message, finish) {
  const dt = new Date().toISOString()
  console.log(`${finish ? chalk.green(dt): chalk.yellow(dt)}: ${message}`)
}


const questions = [{
  type: 'input',
  name: 'filepath',
  message: 'Please provide file.txt with words for processing with file path relative to current folder:',
  default: 'test.txt',
  validate: function (value) {
    if (fs.existsSync(resolve(__dirname, value))) {
      return true
    } else {
      return "Please provide a correct path: " + resolve(__dirname, value) + " is not found"
    }
  }
}, {
  type: 'confirm',
  name: 'clear',
  default: 'Y',
  message: 'Would you like to clear the res folder?'
}, ]


async function hi() {
  const { filepath, clear } = await inquirer.prompt(questions)
  if(clear) {
    fs.emptyDirSync(resolve(__dirname, 'res'))
  }
  if(filepath) {
    parseFile(resolve(__dirname, filepath))
  }
}


const lines = []
function parseFile(filepath) {
  lineReader.eachLine(filepath, function (line) {
    lines.push(line)
  }, function (err) {
    if (err) throw err;
    log(`Found ${lines.length} words in ${filepath}`);
    init()
  });
}


/**
 * Main procedure
 */
async function init() {

  // we will start the puppeteer in headless mode (without GUI)
  const browser = await puppeteer.launch({
    headless: true
  });

  // open first tab for punctutation checking
  let punctuation = await getPunctuation(browser, lines)
  log(`Got punctuation for ${punctuation.length} words`);

  // use remote api to get lema of the words
  let lema = await getLema(punctuation)
  log(`Got lema for ${lema.length} words`);

  // open another tab for declension calculation
  const declension = await getDeclension(browser, lema)
  log(`Got declension result`);

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
  for await (let line of lines) {
    await page.$eval("#input", (el, line) => {
      el.value = line
    }, line)
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
async function getLema(lines) {
  const result = []
  for await (const line of lines) {
    const uri = encodeURI('https://nlp.fi.muni.cz/languageservices/service.py?call=tagger&lang=cs&output=json&text=' + line)
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

  for await (let line of lines) {
    await page.type('#in', line);
    await page.keyboard.press('Enter');
    await page.waitForNavigation();
    const results = await page.$$eval('td[bgcolor="#eeeeee"]', el => {
      return el.map(data => data.textContent.trim());
    });

    let unique = []
    // some words may return result in format  "ulica/ulice/ulici", 
    // we will flat the result to a single unique array 
    results.forEach(res => {
      let temp = res.split('/')
      temp.forEach(t => {
        let cleared = deburr(t)
        if (cleared) {
          unique.push(cleared)
        }
      })
    })
    // all keys and values are deburred 
    let key = deburr(line.charAt(0));
    if (!result[key]) {
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
  keys.forEach(k => {
    let item = storage[k]
    let res = ''
    for (let i in item) {
      counter++
      res += `${i}: ${item[i].join(', ')} \n`
    }
    fs.appendFileSync(resolve(__dirname, 'res', k + '.txt'), res, {
      flags: "a+"
    });
  })
  return log(`Stored ${counter} words`, true);
} // writeToFolder



hi()
