// Indian cities used in the "Travelling From" dropdown
window.INDIAN_CITIES = [
    "Agartala","Agra","Ahmedabad","Ajmer","Aligarh","Allahabad (Prayagraj)","Amravati","Amritsar","Aurangabad",
    "Bangalore (Bengaluru)","Bareilly","Belgaum","Bhavnagar","Bhilai","Bhopal","Bhubaneswar","Bikaner","Bilaspur","Bokaro",
    "Chandigarh","Chennai","Coimbatore","Cuttack",
    "Dehradun","Delhi / New Delhi","Dhanbad","Dharamshala","Dibrugarh","Dimapur","Durgapur",
    "Erode",
    "Faridabad",
    "Gandhinagar","Gangtok","Gaya","Ghaziabad","Goa (Panaji)","Gorakhpur","Greater Noida","Gulbarga (Kalaburagi)","Guntur","Gurgaon (Gurugram)","Guwahati","Gwalior",
    "Haldwani","Haridwar","Hisar","Hubli-Dharwad","Hyderabad",
    "Imphal","Indore","Itanagar",
    "Jabalpur","Jaipur","Jalandhar","Jammu","Jamnagar","Jamshedpur","Jhansi","Jodhpur",
    "Kakinada","Kanpur","Karnal","Kochi (Cochin)","Kohima","Kolhapur","Kolkata","Kota","Kozhikode (Calicut)","Kurnool",
    "Lucknow","Ludhiana",
    "Madurai","Mangalore (Mangaluru)","Mathura","Meerut","Moradabad","Mumbai","Muzaffarpur","Mysore (Mysuru)",
    "Nagpur","Nashik","Nellore","Noida",
    "Panaji","Panchkula","Patiala","Patna","Pondicherry (Puducherry)","Pune",
    "Raipur","Rajahmundry","Rajkot","Ranchi","Rohtak","Rourkela",
    "Saharanpur","Salem","Shillong","Shimla","Siliguri","Solapur","Srinagar","Surat",
    "Thane","Thiruvananthapuram (Trivandrum)","Thrissur","Tiruchirappalli (Trichy)","Tirunelveli","Tirupati","Tiruppur",
    "Udaipur","Ujjain",
    "Vadodara (Baroda)","Varanasi (Banaras)","Vasai-Virar","Vellore","Vijayawada","Visakhapatnam (Vizag)",
    "Warangal"
];

// Populate any <select data-cities-for="..."> with the city list. Default selection: Bangalore.
document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('select[data-cities]').forEach(function (sel) {
        var defaultCity = sel.getAttribute('data-default') || 'Bangalore (Bengaluru)';
        var frag = document.createDocumentFragment();

        var placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'Select your city';
        frag.appendChild(placeholder);

        window.INDIAN_CITIES.forEach(function (label) {
            var opt = document.createElement('option');
            // value = label without parenthetical alt name
            opt.value = label.replace(/\s*\(.*?\)\s*/g, '').replace(/\s*\/.*$/, '').trim();
            opt.textContent = label;
            if (label === defaultCity) opt.selected = true;
            frag.appendChild(opt);
        });

        sel.appendChild(frag);
    });
});