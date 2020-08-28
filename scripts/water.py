import requests
import re
from bs4 import BeautifulSoup


def make_soup(url):
    request = requests.get(url)
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
    return float(number[0])


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

if __name__ == "__main__":
    url = "https://www.ncei.noaa.gov/access/data/coastal-water-temperature-guide/cpac.html"
    tag = "b"
    index_to_extract = 0
    html_extract = make_soup(url)
    bold_tags = find_by_tag(html_extract, tag)
    #print_list(bold_tags)
    string_result = select_list_item(bold_tags, index_to_extract)
    temp = clean_item(string_result)
    print(temp)
    print(proccess_water_temperature_avila(temp))