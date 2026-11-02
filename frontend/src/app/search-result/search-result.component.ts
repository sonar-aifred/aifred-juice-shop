/*
 * Copyright (c) 2014-2026 Bjoern Kimminich & the OWASP Juice Shop contributors.
 * SPDX-License-Identifier: MIT
 */

/* eslint-disable @typescript-eslint/prefer-for-of */
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router'
import { ProductService } from '../Services/product.service'
import { type AfterViewInit, Component, NgZone, type OnDestroy, ViewChild, ChangeDetectorRef, ElementRef, inject, ChangeDetectionStrategy } from '@angular/core'
import { MatPaginator } from '@angular/material/paginator'
import { BehaviorSubject, forkJoin, type Subscription } from 'rxjs'
import { filter } from 'rxjs/operators'
import { MatSelectModule } from '@angular/material/select'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatInputModule } from '@angular/material/input'
import { MatTableDataSource } from '@angular/material/table'
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser'
import { TranslateModule } from '@ngx-translate/core'
import { SocketIoService } from '../Services/socket-io.service'

import { library } from '@fortawesome/fontawesome-svg-core'
import { faCartPlus, faEye } from '@fortawesome/free-solid-svg-icons'
import { ProductTableEntry } from '../Models/product.model'
import { QuantityService } from '../Services/quantity.service'
import { DeluxeGuard } from '../app.guard'
import { MatButtonModule } from '@angular/material/button'
import { MatCardModule, MatCardTitle, MatCardContent } from '@angular/material/card'
import { AsyncPipe } from '@angular/common'
import { ProductComponent } from '../product/product.component'

library.add(faEye, faCartPlus)

type SortOption = 'name' | 'price-asc' | 'price-desc'
const SORT_COMPARATORS: Record<SortOption, (a: ProductTableEntry, b: ProductTableEntry) => number> = {
  name: (a, b) => a.name.localeCompare(b.name),
  'price-asc': (a, b) => a.price - b.price,
  'price-desc': (a, b) => b.price - a.price
}

@Component({
  changeDetection: ChangeDetectionStrategy.Eager,
  selector: 'app-search-result',
  templateUrl: './search-result.component.html',
  styleUrls: ['./search-result.component.scss'],
  imports: [MatCardModule, TranslateModule, MatButtonModule, MatCardTitle, MatCardContent, MatPaginator, AsyncPipe, ProductComponent, MatSelectModule, MatFormFieldModule, MatInputModule]
})
export class SearchResultComponent implements OnDestroy, AfterViewInit {
  private readonly deluxeGuard = inject(DeluxeGuard)
  private readonly productService = inject(ProductService)
  private readonly quantityService = inject(QuantityService)
  private readonly router = inject(Router)
  private readonly route = inject(ActivatedRoute)
  private readonly sanitizer = inject(DomSanitizer)
  private readonly ngZone = inject(NgZone)
  private readonly io = inject(SocketIoService)
  private readonly cdRef = inject(ChangeDetectorRef)
  private readonly elRef = inject(ElementRef)

  public tableData!: ProductTableEntry[]
  public pageSizeOptions: number[] = []
  public dataSource!: MatTableDataSource<ProductTableEntry>
  private _gridDataSource!: BehaviorSubject<ProductTableEntry[]>
  public searchValue?: SafeHtml
  public sortOption: SortOption = 'name'
  public maxPrice?: number
  private allProducts: ProductTableEntry[] = []
  private trackedDataSource?: MatTableDataSource<ProductTableEntry>
  public resultsLength = 0
  public currentPageSize = 15
  @ViewChild(MatPaginator, { static: true }) paginator!: MatPaginator
  private routerSubscription?: Subscription
  private gridDataSourceSubscription?: Subscription
  private resizeObserver?: ResizeObserver
  public emptyState = false

  constructor () {
    this.router.events.pipe(filter(event => event instanceof NavigationEnd)).subscribe(() => {
      this.applySortAndPriceFilter()
    })
  }

  get gridDataSource (): BehaviorSubject<ProductTableEntry[]> {
    return this._gridDataSource
  }

  set gridDataSource (value: BehaviorSubject<ProductTableEntry[]>) {
    this._gridDataSource = value
    this.applySortAndPriceFilter()
  }

  // vuln-code-snippet start restfulXssChallenge
  ngAfterViewInit () {
    const products = this.productService.search('')
    const quantities = this.quantityService.getAll()
    forkJoin([quantities, products]).subscribe({
      next: ([quantities, products]) => {
        const dataTable: ProductTableEntry[] = []
        this.tableData = products
        this.trustProductDescription(products) // vuln-code-snippet neutral-line restfulXssChallenge
        for (const product of products) {
          dataTable.push({
            name: product.name,
            price: product.price,
            deluxePrice: product.deluxePrice,
            id: product.id,
            image: product.image,
            description: product.description,
            alternateImages: product.alternateImages
          })
        }
        for (const quantity of quantities) {
          const entry = dataTable.find((dataTableEntry) => {
            return dataTableEntry.id === quantity.ProductId
          })
          if (entry === undefined) {
            continue
          }
          entry.quantity = quantity.quantity
          entry.limitPerUser = quantity.limitPerUser
        }
        this.dataSource = new MatTableDataSource<ProductTableEntry>(dataTable)
        this.updatePageSizeOptions()
        this.dataSource.paginator = this.paginator
        this.setupResponsivePageSize()
        this.gridDataSource = this.dataSource.connect()
        this.resultsLength = this.dataSource.data.length
        this.filterTable()
        this.routerSubscription = this.router.events.subscribe(() => {
          this.filterTable()
        })
        const challenge: string = this.route.snapshot.queryParams.challenge // vuln-code-snippet hide-start
        if (challenge && this.route.snapshot.url.join('').match(/hacking-instructor/)) {
          this.startHackingInstructor(decodeURIComponent(challenge))
        } // vuln-code-snippet hide-end
        this.cdRef.detectChanges()
      },
      error: (err) => { console.log(err) }
    })
  }

  trustProductDescription (tableData: any[]) { // vuln-code-snippet neutral-line restfulXssChallenge
    for (let i = 0; i < tableData.length; i++) { // vuln-code-snippet neutral-line restfulXssChallenge
      tableData[i].description = this.sanitizer.bypassSecurityTrustHtml(tableData[i].description) // vuln-code-snippet vuln-line restfulXssChallenge
    } // vuln-code-snippet neutral-line restfulXssChallenge
  } // vuln-code-snippet neutral-line restfulXssChallenge

  // vuln-code-snippet end restfulXssChallenge

  ngOnDestroy () {
    if (this.routerSubscription) {
      this.routerSubscription.unsubscribe()
    }

    if (this.dataSource) {
      this.dataSource.disconnect()
    }

    if (this.gridDataSourceSubscription) {
      this.gridDataSourceSubscription.unsubscribe()
    }

    if (this.resizeObserver) {
      this.resizeObserver.disconnect()
    }
  }

  // vuln-code-snippet start localXssChallenge xssBonusChallenge
  filterTable () {
    let queryParam: string = this.route.snapshot.queryParams.q
    if (queryParam) {
      queryParam = queryParam.trim()
      this.ngZone.runOutsideAngular(() => { // vuln-code-snippet hide-start
        this.io.socket().emit('verifyLocalXssChallenge', queryParam)
      }) // vuln-code-snippet hide-end
      this.dataSource.filter = queryParam.toLowerCase()
      this.searchValue = this.sanitizer.bypassSecurityTrustHtml(queryParam) // vuln-code-snippet vuln-line localXssChallenge xssBonusChallenge
      if (this.gridDataSourceSubscription) {
        this.gridDataSourceSubscription.unsubscribe()
      }
      this.gridDataSourceSubscription = this.gridDataSource.subscribe((result: ProductTableEntry[]) => {
        if (result.length === 0) {
          this.emptyState = true
        } else {
          this.emptyState = false
        }
      })
    } else {
      this.dataSource.filter = ''
      this.searchValue = undefined
      this.emptyState = false
    }
  }
  // vuln-code-snippet end localXssChallenge xssBonusChallenge

  onSortChange (sort: SortOption) {
    this.updateQueryParams({ sort: sort === 'name' ? null : sort })
  }

  onMaxPriceChange (value: string) {
    this.updateQueryParams({ maxPrice: value.trim() === '' ? null : value.trim() })
  }

  private updateQueryParams (queryParams: Record<string, string | null>) {
    void this.router.navigate([], { queryParams, queryParamsHandling: 'merge' })
  }

  private applySortAndPriceFilter () {
    // deferred so it runs after filterTable() has updated the text filter and empty state for the same navigation
    queueMicrotask(() => {
      if (!this.dataSource) return
      const params = this.route.snapshot.queryParams
      const sort: SortOption = (params.sort in SORT_COMPARATORS) ? params.sort : 'name'
      const maxPrice = Number.parseFloat(params.maxPrice)
      this.maxPrice = Number.isNaN(maxPrice) ? undefined : maxPrice

      if (this.trackedDataSource !== this.dataSource) {
        this.trackedDataSource = this.dataSource
        this.allProducts = this.dataSource.data
      }
      this.sortOption = sort
      this.dataSource.data = this.allProducts
        .filter(product => this.maxPrice === undefined || product.price <= this.maxPrice)
        .sort(SORT_COMPARATORS[sort])
      this.emptyState = this.dataSource.filteredData.length === 0
      this.cdRef.detectChanges()
    })
  }

  private setupResponsivePageSize () {
    const grid = this.elRef.nativeElement.querySelector('.products-grid')
    if (!grid) return
    this.resizeObserver = new ResizeObserver(() => {
      this.ngZone.run(() => {
        this.updatePageSize(grid)
      })
    })
    this.resizeObserver.observe(grid)
  }

  private updatePageSize (grid: Element) {
    const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').length
    const pageSize = Math.ceil(15 / columns) * columns
    if (pageSize !== this.currentPageSize) {
      this.currentPageSize = pageSize
      this.paginator.pageSize = pageSize
      this.updatePageSizeOptions()
      this.paginator.page.emit({
        pageIndex: this.paginator.pageIndex,
        pageSize: this.currentPageSize,
        length: this.paginator.length
      })
      this.cdRef.detectChanges()
    }
  }

  private updatePageSizeOptions () {
    this.pageSizeOptions = []
    for (let i = 1; i <= Math.ceil(this.dataSource.data.length / this.currentPageSize); i++) {
      this.pageSizeOptions.push(i * this.currentPageSize)
    }
    this.paginator.pageSizeOptions = this.pageSizeOptions
  }

  startHackingInstructor (challengeName: string) {
    console.log(`Starting instructions for challenge "${challengeName}"`)
    import('../../hacking-instructor').then(module => {
      module.startHackingInstructorFor(challengeName)
    })
  }

  isLoggedIn (): boolean {
    return localStorage.getItem('token') !== null
  }

  isDeluxe () {
    return this.deluxeGuard.isDeluxe()
  }
}
