const submitButton = document.getElementById("searchButton");
const toastNotification = document.getElementById("liveToast");
const toastBootstrap = bootstrap.Toast.getOrCreateInstance(toastNotification);

function renderItems(result) {
    document.getElementById("results").innerHTML = "";
    result.forEach((element) => {
        const top = `
            <div>
                <div class="card">
                    <img src="${element.info.image}" class="card-img-top">
                    <div class="card-body">
                        <h5 class="card-title">${element.info.title}</h5>
                        <p class="card-text">Purchase options</p>
                    </div>
                    <ul class="list-group list-group-flush">
            `;

        let middle = "";
        let index = 0;

        if (element.prices.length == 0) {
            middle += `<li class="list-group-item d-flex justify-content-between">Not available</li>`;
        }

        element.prices.forEach((price) => {
            if (price.discount == 0) {
                middle += `
                    <li onclick="deleteFromList(${
                        element.link.split("/")[4]
                    }, ${index})" style="cursor: pointer;" class="list-group-item d-flex justify-content-between">
                        ${price.title.split(" ").slice(1).join(" ")}
                        <span class="ms-3">${price.original}</span>
                    </li>
                `;
            }

            if (price.discount != 0) {
                middle += `
                    <li class="list-group-item d-flex justify-content-between" style="cursor: pointer;" onclick="deleteFromList(${
                        element.link.split("/")[4]
                    }, ${index})">
                        ${price.title.split(" ").slice(1).join(" ")}
                        <div style="display: inline-flex; align-items: center; gap: .5rem; margin-left .5rem;">
                            <span class="badge rounded-pill text-bg-info">${
                                price.discount
                            }</span>
                            <div class="priceDiscount">
                                <span class="text-danger">${
                                    price.original
                                }</span>
                                <span>${price.finally}</span>
                            </div>
                        </div>
                    </li>
                `;
            }

            index++;
        });

        const bottom = `
                    </ul>
                    <div class="card-body">
                        <a style="text-decoration: none;" href="${element.link}" target="_blank" class="card-link">Open on Steam <i class="bi bi-box-arrow-up-right"></i></a>
                    </div>
                </div>
            </div>
            `;

        const item = top + middle + bottom;

        document.getElementById("results").innerHTML += item;
    });
}

async function isAuthenticated() {
    const response = await fetch("http://localhost:3000/auth");
    const result = await response.json();

    if (result.authenticated) {
        return result.token;
    }

    return false;
}

function decodeJwt(token) {
    const parts = token.split(".");
    const decodedPayload = atob(parts[1]);
    const payloadObject = JSON.parse(decodedPayload);

    return payloadObject;
}

async function deleteFromList(appId, index) {
    const token = await isAuthenticated();

    if (!token) {
        document.getElementById("serverMessage").innerHTML = `
            You are not logged in, log in to add games to your list,
            <a href="/login">Click here</a>
        `;

        return toastBootstrap.show();
    }

    fetch(`http://localhost:3000/list/${appId}/${index}`, { method: "DELETE" })
        .then((response) => response.json())
        .then((result) => console.log(result));
}

window.onload = async () => {
    const token = await isAuthenticated();

    if (token) {
        const user = decodeJwt(token);

        document.getElementById("account").innerHTML = `
            <div class="dropdown">
                <button class="btn btn-dark d-flex align-items-center dropdown-toggle" type="button" data-bs-toggle="dropdown" aria-expanded="false">
                    <img class="rounded me-2" width="20px" src="${user.photo}">
                    ${user.name}
                </button>
                <ul class="dropdown-menu">
                    <li class="px-3">${user.email}</li>
                    <li><hr class="dropdown-divider"></li>
                    <li><a class="dropdown-item" href="http://localhost:3000/logout">Log out</a></li>
                </ul>
            </div>
        `;
    }

    const response = await fetch("http://localhost:3000/list");
    const result = await response.json();

    renderItems(result);
};
