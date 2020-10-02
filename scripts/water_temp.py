import requests
import re
from bs4 import BeautifulSoup

headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '3600',
    'User-Agent': 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:52.0) Gecko/20100101 Firefox/52.0'
}

def make_soup(url):
    request = requests.get(url, headers)
    soup = BeautifulSoup(request.content, 'html.parser')
    return soup


def print_html(my_soup):
    print(my_soup.prettify())
    return


def find_by_tag(soup, tag):
    tags = soup.find_all(tag)
    return tags


def print_list(list):
    for item in list:
        print(item)
    return

def select_list_item(list, pos):
    search_index = 0
    selected_item = ""
    for item in list:
        if search_index == pos:
            selected_item = item
        search_index += 1
    return str(selected_item)


def clean_item(item):
    # Assuming the string only contains one number and that number is the one we want
    number = re.findall(r"\d*\.?\d+", item)
    return_number = float(number[0])
    if return_number < 30:
        return_number = c_to_f(return_number)
    return round(return_number, 1)


def c_to_f(celsius):
    return (celsius * 1.8 + 32)


def proccess_water_temperature_avila(temp):
    # This function returns my personal water temperature feelsing at avila beach
    rounded_temp = round(temp)
    # Could use a switch but if seems more elegant at the moment
    if rounded_temp < 50:
        feeling = "Freezing Cold - Don't even touch it"
    elif rounded_temp < 55:
        feeling = "Very Cold - Feet in or maybe a very quick cold dip"
    elif rounded_temp < 58:
        feeling = "Quite Cold - Feet in not bad, Quick dip is cold"
    elif rounded_temp < 60:
        feeling = "Cold - Feet in feels nice, Quick dip tolerable"
    elif rounded_temp < 62:
        feeling = "Cool - Comfortable for quick dip. Longer dip is possible"
    elif rounded_temp < 63:
        feeling = "Cool - Quite nice" 
    elif rounded_temp < 65:
        feeling = "Mild - Comfortable"
    elif rounded_temp < 70:
        feeling = "Mild - Very Comfortable" 
    else:
        feeling = "Temperature cannot be analyzed"
    return feeling

def get_suit(temp):
    if temp > 65:
        return "Shorts"
    if temp > 60:
        return "Springsuit"
    return "Fullsuit"


def get_water_temp(beach_name, url):
    print("\n")
    print(beach_name)
    tag = "b"
    index_to_extract = 0
    html_extract = make_soup(url)
    bold_tags = find_by_tag(html_extract, tag)
    #print_list(bold_tags)
    string_result = select_list_item(bold_tags, index_to_extract)
    temp = clean_item(string_result)
    print(temp)
    print(proccess_water_temperature_avila(temp))
    #print("\n")
    return


def get_avila_water():
    name = "AVILA BEACH"
    url = "https://www.ncei.noaa.gov/access/data/coastal-water-temperature-guide/cpac.html"
    get_water_temp(name, url)

def get_cayucos_water():
    name = "CAYUCOS BEACH"
    url = "https://www.surf-forecast.com/breaks/Cayucos-Pier/seatemp"
    get_water_temp(name, url)

def get_pismo_water():
    name = "PISMO BEACH"
    url = "https://www.surf-forecast.com/breaks/Pismo-Beach-Pier/seatemp"
    get_water_temp(name, url)

def get_morro_water():
    name = "MORRO ROCK BEACH"
    url = "https://www.surf-forecast.com/breaks/Morro-Rock/seatemp"
    get_water_temp(name, url)

if __name__ == "__main__":
    get_avila_water()
    get_cayucos_water()
    get_pismo_water()
    get_morro_water()